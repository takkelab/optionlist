-- migrate:up
-- 匿名アカウントとデータの分離（data.md §2・§4、docs/decisions/0033・0034・0046・0048）
-- ol_migrator で流す。ロール（ol_*）は先に npm --prefix backend run db:roles で作っておく
-- 既存の options・achievements に持ち主を付けられないので、行が残っていると user_id の NOT NULL で止まる（手元の DB は作り直す。0048）

-- 匿名アカウント。鍵と復旧コードは SHA-256 だけを持つ
CREATE TABLE users (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_hash BYTEA NOT NULL CONSTRAINT uq_users_session_hash UNIQUE,
  recovery_code_hash BYTEA NULL CONSTRAINT uq_users_recovery_code_hash UNIQUE,
  created_at TIMESTAMPTZ(3) NOT NULL,
  last_seen_at TIMESTAMPTZ(3) NOT NULL
);
-- 保存期間（data.md §5）の判定に使う
CREATE INDEX idx_users_last_seen_at ON users (last_seen_at);

-- アカウントの作成・復旧コードの入力の回数（api.md §6）。IP は HMAC したものだけを持つ
CREATE TABLE auth_attempts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind TEXT NOT NULL CONSTRAINT chk_auth_attempts_kind CHECK (kind IN ('create_account', 'restore')),
  ip_hash BYTEA NOT NULL,
  occurred_at TIMESTAMPTZ(3) NOT NULL
);
CREATE INDEX idx_auth_attempts_kind_ip_hash_occurred_at ON auth_attempts (kind, ip_hash, occurred_at);

-- options の持ち主。同じ人が同じ提案を二重に追加できない（別の人は追加できる）
ALTER TABLE options ADD COLUMN user_id BIGINT NOT NULL CONSTRAINT fk_options_user REFERENCES users (id) ON DELETE CASCADE;
ALTER TABLE options DROP CONSTRAINT uq_options_suggestion_id;
ALTER TABLE options ADD CONSTRAINT uq_options_user_id_suggestion_id UNIQUE (user_id, suggestion_id);
-- achievements の複合外部キーの参照先
ALTER TABLE options ADD CONSTRAINT uq_options_id_user_id UNIQUE (id, user_id);
DROP INDEX idx_options_status_sort_order;
CREATE INDEX idx_options_user_id_status_sort_order ON options (user_id, status, sort_order);
CREATE INDEX idx_options_user_id_status_completed_at ON options (user_id, status, completed_at);

-- achievements の持ち主は options から写して持つ（RLS を表ごとに判定するため）。複合外部キーで、項目の持ち主と必ず同じになる
ALTER TABLE achievements ADD COLUMN user_id BIGINT NOT NULL;
ALTER TABLE achievements DROP CONSTRAINT fk_achievements_option;
ALTER TABLE achievements ADD CONSTRAINT fk_achievements_option_user
  FOREIGN KEY (option_id, user_id) REFERENCES options (id, user_id) ON DELETE CASCADE;
CREATE INDEX idx_achievements_user_id ON achievements (user_id);
-- 写真の配信で、そのファイル名が自分の達成の写真かを引く（api.md §5）
ALTER TABLE achievements ADD CONSTRAINT uq_achievements_photo_filename UNIQUE (photo_filename);

-- 権限（data.md §4 のロールの表）
GRANT SELECT, INSERT, UPDATE, DELETE ON users, options, achievements TO ol_app;
GRANT SELECT ON themes, suggestions, tags, suggestion_tags TO ol_app;
GRANT INSERT ON events TO ol_app;
GRANT SELECT, DELETE ON users, options, achievements, events, auth_attempts TO ol_cleanup;
GRANT SELECT ON users, options, achievements, events TO ol_incident;
GRANT SELECT, INSERT, UPDATE ON users TO ol_definer;
GRANT SELECT, INSERT ON auth_attempts TO ol_definer;
GRANT SELECT ON options, achievements TO ol_definer;
-- 認証の関数を ol_definer として作るため（PostgreSQL 15 から public の CREATE は PUBLIC にない）
GRANT USAGE, CREATE ON SCHEMA public TO ol_definer;

-- RLS。持ち主（ol_migrator）にも効かせる。ポリシーはロールごとに付ける（ポリシーのないロールは 1 行も読めない）
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
ALTER TABLE options ENABLE ROW LEVEL SECURITY;
ALTER TABLE options FORCE ROW LEVEL SECURITY;
ALTER TABLE achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE achievements FORCE ROW LEVEL SECURITY;

-- ol_app は自分の行だけ。app.user_id は UserScopedDatabase.run が SET LOCAL する。
-- 一度 SET LOCAL した接続では、トランザクションのあとも空文字が返るので NULLIF で包む（未設定なら NULL と比べて 0 行）
CREATE POLICY users_app ON users TO ol_app
  USING (id = NULLIF(current_setting('app.user_id', true), '')::bigint)
  WITH CHECK (id = NULLIF(current_setting('app.user_id', true), '')::bigint);
CREATE POLICY options_app ON options TO ol_app
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::bigint)
  WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), '')::bigint);
CREATE POLICY achievements_app ON achievements TO ol_app
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::bigint)
  WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), '')::bigint);

-- 全員の行を扱うロール（BYPASSRLS は付けない。docs/decisions/0034）
CREATE POLICY users_migrator ON users TO ol_migrator USING (true) WITH CHECK (true);
CREATE POLICY options_migrator ON options TO ol_migrator USING (true) WITH CHECK (true);
CREATE POLICY achievements_migrator ON achievements TO ol_migrator USING (true) WITH CHECK (true);
CREATE POLICY users_definer ON users TO ol_definer USING (true) WITH CHECK (true);
CREATE POLICY options_definer ON options TO ol_definer USING (true) WITH CHECK (true);
CREATE POLICY achievements_definer ON achievements TO ol_definer USING (true) WITH CHECK (true);
CREATE POLICY users_cleanup_select ON users FOR SELECT TO ol_cleanup USING (true);
CREATE POLICY users_cleanup_delete ON users FOR DELETE TO ol_cleanup USING (true);
CREATE POLICY options_cleanup_select ON options FOR SELECT TO ol_cleanup USING (true);
CREATE POLICY options_cleanup_delete ON options FOR DELETE TO ol_cleanup USING (true);
CREATE POLICY achievements_cleanup_select ON achievements FOR SELECT TO ol_cleanup USING (true);
CREATE POLICY achievements_cleanup_delete ON achievements FOR DELETE TO ol_cleanup USING (true);
CREATE POLICY users_incident ON users FOR SELECT TO ol_incident USING (true);
CREATE POLICY options_incident ON options FOR SELECT TO ol_incident USING (true);
CREATE POLICY achievements_incident ON achievements FOR SELECT TO ol_incident USING (true);

-- 認証の関数（data.md §4）。RLS の中では鍵から人を探せないので、1 人分だけを返す関数に限って表を横断させる
-- ol_definer として作る（持ち主が最初から ol_definer になる。ol_migrator は INHERIT がないので、こうしないと作り直せない）
SET ROLE ol_definer;

-- 鍵のハッシュから人を探す。last_seen_at も返す（「今日もう書いたか」のために users を読み直さない）
CREATE FUNCTION auth_find_user(p_session_hash bytea)
  RETURNS TABLE (user_id bigint, last_seen_at timestamptz)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT u.id, u.last_seen_at FROM public.users u WHERE u.session_hash = p_session_hash
$$;

-- その IP から直近 1 時間に作ったアカウントが 20 件未満なら作り、auth_attempts に 1 行入れる（api.md §6 ※仮決め）
-- 断った試行は入れない（入れると、断られて試し直すたびに窓が延び、retry_after_seconds が当たらなくなる。docs/decisions/0048）
-- rate_limited の retry_after_seconds は、いちばん古い 1 件が 1 時間の外に出るまでの秒（1 以上）
-- 同じ IP から同時に来ても上限を超えないよう、数える前に IP ごとのアドバイザリロックを取る（トランザクションの終わりで外れる）
CREATE FUNCTION auth_create_user(p_session_hash bytea, p_ip_hash bytea)
  RETURNS TABLE (status text, user_id bigint, retry_after_seconds int)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_count int;
  v_oldest timestamptz;
  v_id bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('auth_create_user:' || encode(p_ip_hash, 'hex'), 0));
  SELECT count(*), min(a.occurred_at) INTO v_count, v_oldest
    FROM public.auth_attempts a
   WHERE a.kind = 'create_account' AND a.ip_hash = p_ip_hash AND a.occurred_at > now() - interval '1 hour';
  IF v_count >= 20 THEN
    RETURN QUERY SELECT 'rate_limited'::text, NULL::bigint,
      greatest(1, ceil(extract(epoch FROM (v_oldest + interval '1 hour' - now())))::int);
    RETURN;
  END IF;
  INSERT INTO public.auth_attempts (kind, ip_hash, occurred_at) VALUES ('create_account', p_ip_hash, now());
  INSERT INTO public.users (session_hash, created_at, last_seen_at) VALUES (p_session_hash, now(), now()) RETURNING id INTO v_id;
  RETURN QUERY SELECT 'ok'::text, v_id, NULL::int;
END
$$;

-- 関数は既定で PUBLIC が実行できる。実行できるのは ol_app だけにする（testing.md §7）
REVOKE EXECUTE ON FUNCTION auth_find_user(bytea), auth_create_user(bytea, bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_find_user(bytea), auth_create_user(bytea, bytea) TO ol_app;

RESET ROLE;

-- migrate:down
SET ROLE ol_definer;
DROP FUNCTION auth_create_user(bytea, bytea);
DROP FUNCTION auth_find_user(bytea);
RESET ROLE;

DROP POLICY achievements_incident ON achievements;
DROP POLICY options_incident ON options;
DROP POLICY users_incident ON users;
DROP POLICY achievements_cleanup_delete ON achievements;
DROP POLICY achievements_cleanup_select ON achievements;
DROP POLICY options_cleanup_delete ON options;
DROP POLICY options_cleanup_select ON options;
DROP POLICY users_cleanup_delete ON users;
DROP POLICY users_cleanup_select ON users;
DROP POLICY achievements_definer ON achievements;
DROP POLICY options_definer ON options;
DROP POLICY users_definer ON users;
DROP POLICY achievements_migrator ON achievements;
DROP POLICY options_migrator ON options;
DROP POLICY users_migrator ON users;
DROP POLICY achievements_app ON achievements;
DROP POLICY options_app ON options;
DROP POLICY users_app ON users;
ALTER TABLE achievements NO FORCE ROW LEVEL SECURITY;
ALTER TABLE achievements DISABLE ROW LEVEL SECURITY;
ALTER TABLE options NO FORCE ROW LEVEL SECURITY;
ALTER TABLE options DISABLE ROW LEVEL SECURITY;

REVOKE USAGE, CREATE ON SCHEMA public FROM ol_definer;
REVOKE ALL ON options, achievements FROM ol_definer;
REVOKE ALL ON options, achievements, events FROM ol_incident;
REVOKE ALL ON options, achievements, events FROM ol_cleanup;
REVOKE ALL ON events FROM ol_app;
REVOKE ALL ON themes, suggestions, tags, suggestion_tags FROM ol_app;
REVOKE ALL ON options, achievements FROM ol_app;

ALTER TABLE achievements DROP CONSTRAINT uq_achievements_photo_filename;
DROP INDEX idx_achievements_user_id;
ALTER TABLE achievements DROP CONSTRAINT fk_achievements_option_user;
ALTER TABLE achievements ADD CONSTRAINT fk_achievements_option FOREIGN KEY (option_id) REFERENCES options (id) ON DELETE CASCADE;
ALTER TABLE achievements DROP COLUMN user_id;

DROP INDEX idx_options_user_id_status_completed_at;
DROP INDEX idx_options_user_id_status_sort_order;
CREATE INDEX idx_options_status_sort_order ON options (status, sort_order);
ALTER TABLE options DROP CONSTRAINT uq_options_id_user_id;
ALTER TABLE options DROP CONSTRAINT uq_options_user_id_suggestion_id;
ALTER TABLE options ADD CONSTRAINT uq_options_suggestion_id UNIQUE (suggestion_id);
ALTER TABLE options DROP COLUMN user_id;

-- users・auth_attempts の権限と RLS は表と一緒に消える
DROP TABLE auth_attempts;
DROP TABLE users;
