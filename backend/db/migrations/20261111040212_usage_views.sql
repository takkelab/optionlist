-- migrate:up
-- 集計のビュー（metrics.md §6、data.md §4。docs/decisions/0043・0060）。npm run metrics:usage が ol_metrics で読む
-- ol_metrics は表を読めないので、件数・割合・日数だけを返すビューを ol_definer の持ち物として作る（RLS は持ち主の ol_definer の USING (true) で効く）
-- ビューは引数を取れないので、期間は今（now()）で終わる直近の 7 日・28 日。始まりは日本時間の 0 時にそろえる（今日を 1 日目に数える）
-- last_seen_at は日本時間のその日の最初のリクエストで 1 日 1 回だけ書く（api.md §6）ので、日の途中で区切ると、始まりの日に使った人を数え漏らす
-- 「日本時間で今日から n 日前の 0 時」は (date_trunc('day', now() AT TIME ZONE 'Asia/Tokyo') - n * interval '1 day') AT TIME ZONE 'Asia/Tokyo'
-- client_error を数えるため、ol_definer に events の SELECT を付ける（events は RLS の対象外。data.md §4）
GRANT SELECT ON events TO ol_definer;

-- ol_definer として作る（持ち主が最初から ol_definer になる。ol_migrator は INHERIT がないので、こうしないと作り直せない。data.md §4）
SET ROLE ol_definer;

-- 期間ごとに 1 行（week = 今日を含む 7 日、four_weeks = 今日を含む 28 日）
-- 使った人: 期間内に last_seen_at を書いた人。達成した人: 使った人のうち、期間内に達成がある人
-- client_error は受け取った時刻（received_at。backend の時計）で数える（occurred_at は端末の時計でずれうる）
CREATE VIEW usage_periods AS
WITH bounds AS (
  SELECT p.period, p.days,
         (date_trunc('day', now() AT TIME ZONE 'Asia/Tokyo') - (p.days - 1) * interval '1 day') AT TIME ZONE 'Asia/Tokyo' AS from_at,
         now() AS to_at
    FROM (VALUES ('week', 7), ('four_weeks', 28)) AS p (period, days)
)
SELECT b.period,
       b.days,
       (SELECT count(*) FROM public.users u WHERE u.last_seen_at >= b.from_at AND u.last_seen_at < b.to_at) AS active_users,
       (SELECT count(DISTINCT a.user_id)
          FROM public.achievements a JOIN public.users u ON u.id = a.user_id
         WHERE a.achieved_at >= b.from_at AND a.achieved_at < b.to_at
           AND u.last_seen_at >= b.from_at AND u.last_seen_at < b.to_at) AS achievers,
       (SELECT count(*) FROM public.achievements a WHERE a.achieved_at >= b.from_at AND a.achieved_at < b.to_at) AS achievements,
       -- 提案から追加した項目（消した項目は数えない）
       (SELECT count(*) FROM public.options o
         WHERE o.suggestion_id IS NOT NULL AND o.created_at >= b.from_at AND o.created_at < b.to_at) AS suggestion_adds,
       -- 期間内に初めて達成した項目の、作成から最初の達成までの日数の中央値（なければ NULL）
       (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM f.first_at - o.created_at) / 86400)
          FROM public.options o
          JOIN (SELECT a.option_id, min(a.achieved_at) AS first_at FROM public.achievements a GROUP BY a.option_id) f ON f.option_id = o.id
         WHERE f.first_at >= b.from_at AND f.first_at < b.to_at) AS first_achievement_days_median,
       (SELECT count(*) FROM public.events e
         WHERE e.type = 'client_error' AND e.received_at >= b.from_at AND e.received_at < b.to_at) AS client_errors
  FROM bounds b;

-- 続けて使った人: 4 週前の週（今日から 27〜21 日前の 7 日。日本時間）に作ったアカウントのうち、
-- その後の 3 週（20 日前の 0 時から今まで）にも使った人。last_seen_at は最後に使った日の最初のリクエストの時刻なので、
-- 最後に使った日があとの 3 週にあれば、その日の 0 時より後になる
CREATE VIEW usage_retention AS
WITH bounds AS (
  SELECT (date_trunc('day', now() AT TIME ZONE 'Asia/Tokyo') - 27 * interval '1 day') AT TIME ZONE 'Asia/Tokyo' AS cohort_from,
         (date_trunc('day', now() AT TIME ZONE 'Asia/Tokyo') - 20 * interval '1 day') AT TIME ZONE 'Asia/Tokyo' AS after_from
)
SELECT count(*) AS cohort,
       count(*) FILTER (WHERE u.last_seen_at >= b.after_from) AS retained
  FROM public.users u CROSS JOIN bounds b
 WHERE u.created_at >= b.cohort_from AND u.created_at < b.after_from;

-- やりたいリストの滞留: 直近 4 週間（usage_periods の four_weeks と同じ）に使った人ごとの
-- 「今の pending のうち、作成から 90 日以上（ちょうど 90 日を含む。24 時間 × 90）たったもの」の件数の中央値（使った人がいなければ NULL）
CREATE VIEW usage_stale_pending AS
SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY s.stale) AS median
  FROM (SELECT u.id,
               count(o.id) FILTER (WHERE o.status = 'pending' AND o.created_at <= now() - 90 * interval '24 hours') AS stale
          FROM public.users u LEFT JOIN public.options o ON o.user_id = u.id
         WHERE u.last_seen_at >= (date_trunc('day', now() AT TIME ZONE 'Asia/Tokyo') - 27 * interval '1 day') AT TIME ZONE 'Asia/Tokyo'
           AND u.last_seen_at < now()
         GROUP BY u.id) s;

-- 直近 4 週間（usage_periods の four_weeks と同じ）の client_error で多いメッセージ（3 つまで）
CREATE VIEW usage_client_error_messages AS
SELECT e.payload->>'message' AS message, count(*) AS errors
  FROM public.events e
 WHERE e.type = 'client_error'
   AND e.received_at >= (date_trunc('day', now() AT TIME ZONE 'Asia/Tokyo') - 27 * interval '1 day') AT TIME ZONE 'Asia/Tokyo'
   AND e.received_at < now()
 GROUP BY e.payload->>'message'
 ORDER BY count(*) DESC, message
 LIMIT 3;

-- 読めるのは ol_metrics だけ（testing.md §7 の usage_views_readers）
GRANT SELECT ON usage_periods, usage_retention, usage_stale_pending, usage_client_error_messages TO ol_metrics;

RESET ROLE;

-- migrate:down
SET ROLE ol_definer;
DROP VIEW usage_client_error_messages;
DROP VIEW usage_stale_pending;
DROP VIEW usage_retention;
DROP VIEW usage_periods;
RESET ROLE;

REVOKE SELECT ON events FROM ol_definer;
