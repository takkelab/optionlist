import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { parseEnv } from "node:util";
import pg from "pg";
import { PgUsageSource } from "../lib/pg-usage-source.ts";

// 集計のビュー（usage_*）を、テスト用 DB（backend/.env.test。CI では test:scripts の前にマイグレーションする）で確かめる
// 行は ol_migrator（RLS を受けない）で入れ、読むのは本番と同じ ol_metrics（ビューしか読めない）
const ENV_FILE = resolve(import.meta.dirname, "../../backend/.env.test");
const { DATABASE_URL: migratorUrl, METRICS_DATABASE_URL: metricsUrl } = parseEnv(readFileSync(ENV_FILE, "utf8"));
if (migratorUrl === undefined || metricsUrl === undefined) {
  throw new Error(`${ENV_FILE} に DATABASE_URL・METRICS_DATABASE_URL がない（足したら npm --prefix backend run db:roles:test を流し直す）`);
}
const migrator = new pg.Pool({ connectionString: migratorUrl, options: "-c TimeZone=UTC" });
const metrics = new pg.Pool({ connectionString: metricsUrl, options: "-c TimeZone=UTC" });
const source = new PgUsageSource(metrics);

// 時刻は 2 通りで入れる（ビューは読んだ時点の now() で区切るので、入れる側も DB の時計で決める）
// - day(n, m): 日本時間で今日から n 日前の 0 時の m 分後（期間の始まりは日本時間の 0 時。docs/decisions/0060）
// - ago(m): 今から m 分前（滞留の 90 日は 24 時間 × 90）
// 境目は 1 分の内と外で確かめる（行を入れる接続と読む接続で now() がずれるため）
type At = { kind: "day" | "ago"; days: number; minutes: number };
const day = (days: number, minutes = 0): At => ({ kind: "day", days, minutes });
const ago = (minutes: number): At => ({ kind: "ago", days: 0, minutes });
const HOUR = 60;
const DAY = 24 * HOUR;
// $n・$n+1・$n+2 に kind・days・minutes を渡す
const atSql = (n: number) =>
  `CASE WHEN $${n}::text = 'day'
     THEN (date_trunc('day', now() AT TIME ZONE 'Asia/Tokyo') - $${n + 1}::int * interval '1 day') AT TIME ZONE 'Asia/Tokyo' + $${n + 2}::int * interval '1 minute'
     ELSE now() - $${n + 2}::int * interval '1 minute' END`;
const atParams = (at: At) => [at.kind, at.days, at.minutes];
// 昼の 12 時（日本時間）。境目から遠い、ふつうの時刻
const noon = (days: number) => day(days, 12 * HOUR);

let hash = 0;
const addUser = async (created: At, lastSeen: At): Promise<number> => {
  hash += 1;
  const { rows } = await migrator.query<{ id: string }>(
    `INSERT INTO users (session_hash, created_at, last_seen_at) VALUES ($1, ${atSql(2)}, ${atSql(5)}) RETURNING id`,
    [Buffer.from(`u${hash}`), ...atParams(created), ...atParams(lastSeen)],
  );
  return Number(rows[0]?.id);
};
const addOption = async (userId: number, created: At, extra: { suggestionId?: number; completed?: boolean } = {}): Promise<number> => {
  const { rows } = await migrator.query<{ id: string }>(
    `INSERT INTO options (user_id, title, status, suggestion_id, sort_order, created_at, updated_at)
     VALUES ($1, 'x', $2, $3, 0, ${atSql(4)}, now()) RETURNING id`,
    [userId, extra.completed === true ? "completed" : "pending", extra.suggestionId ?? null, ...atParams(created)],
  );
  return Number(rows[0]?.id);
};
const achieve = (userId: number, optionId: number, at: At) =>
  migrator.query(`INSERT INTO achievements (user_id, option_id, achieved_at) VALUES ($1, $2, ${atSql(3)})`, [userId, optionId, ...atParams(at)]);
// 数えるのは受け取った時刻（received_at）。端末の時計（occurred_at）はわざと期間の外にする
const addEvent = (type: string, message: string | null, received: At) =>
  migrator.query(`INSERT INTO events (type, payload, occurred_at, received_at) VALUES ($1, $2, now() + interval '1 year', ${atSql(3)})`, [
    type,
    JSON.stringify(message === null ? { route: "/" } : { message, route: "/" }),
    ...atParams(received),
  ]);

const clear = () => migrator.query("TRUNCATE TABLE achievements, auth_attempts, events, options, users RESTART IDENTITY");

// 行を入れる SQL とビューを読む SQL は別々に「日本時間の 0 時」を決めるので、その間に 0 時をまたぐと境目が 1 日ずれる
// 0 時まで 2 分を切っていたら、0 時を過ぎるまで待ってから始める（テストは全部で数秒で終わる）
const waitPastMidnightInJapan = async () => {
  const { rows } = await migrator.query<{ seconds: number }>(
    "SELECT extract(epoch FROM date_trunc('day', now() AT TIME ZONE 'Asia/Tokyo') + interval '1 day' - now() AT TIME ZONE 'Asia/Tokyo')::float8 AS seconds",
  );
  const seconds = rows[0]?.seconds ?? Infinity;
  if (seconds < 120) await new Promise((resolve) => setTimeout(resolve, (seconds + 5) * 1000));
};

describe("PgUsageSource (usage_* views read as ol_metrics)", () => {
  before(async () => {
    await waitPastMidnightInJapan();
    await clear();
  });
  beforeEach(clear);
  after(async () => {
    await clear();
    await migrator.end();
    await metrics.end();
  });

  // 1 週間は今日を含む 7 日（6 日前の 0 時から）、4 週間は 28 日（27 日前の 0 時から）
  it("counts the people whose last_seen_at falls in the last 7 and 28 days, from midnight in Japan", async () => {
    for (const lastSeen of [day(6, 1), day(6, -1), day(27, 1), day(27, -1), ago(1)]) await addUser(noon(100), lastSeen);
    const { week, fourWeeks } = await source.periods();
    assert.equal(week.activeUsers, 2);
    assert.equal(fourWeeks.activeUsers, 4);
  });

  it("counts every achievement in the period, and as achievers only the people who used it", async () => {
    const a = await addUser(noon(100), noon(1));
    const b = await addUser(noon(100), noon(10));
    const optionA = await addOption(a, noon(50));
    const optionB = await addOption(b, noon(50));
    for (const at of [noon(1), day(6, 1), day(6, -1), day(27, -1)]) await achieve(a, optionA, at);
    await achieve(b, optionB, noon(10));
    // 期間内に達成していても、last_seen_at が期間の前の人は「使った人」でないので達成した人に数えない
    const c = await addUser(noon(100), day(27, -1));
    const optionC = await addOption(c, noon(50));
    await achieve(c, optionC, noon(5));
    const { week, fourWeeks } = await source.periods();
    assert.deepEqual([week.achievements, week.achievers], [3, 1]);
    assert.deepEqual([fourWeeks.achievements, fourWeeks.achievers], [5, 2]);
  });

  it("counts the options added from a suggestion in the period", async () => {
    const a = await addUser(noon(100), noon(1));
    await addOption(a, noon(1), { suggestionId: 1 });
    await addOption(a, noon(1));
    await addOption(a, noon(20), { suggestionId: 2 });
    await addOption(a, day(27, -1), { suggestionId: 3 });
    const { week, fourWeeks } = await source.periods();
    assert.deepEqual([week.suggestionAdds, fourWeeks.suggestionAdds], [1, 2]);
  });

  it("takes the median days to the very first achievement of the options first achieved in the period", async () => {
    const a = await addUser(noon(100), noon(1));
    const fast = await addOption(a, noon(10));
    await achieve(a, fast, noon(6));
    const slow = await addOption(a, noon(20));
    await achieve(a, slow, noon(10));
    // 最初の達成が期間の前にある項目は、期間内にまた達成しても数えない
    const old = await addOption(a, noon(40));
    await achieve(a, old, noon(30));
    await achieve(a, old, noon(2));
    const { week, fourWeeks } = await source.periods();
    assert.ok(Math.abs((week.firstAchievementDaysMedian ?? 0) - 4) < 0.01);
    assert.ok(Math.abs((fourWeeks.firstAchievementDaysMedian ?? 0) - 7) < 0.01);
  });

  it("returns null for the median when nothing was achieved for the first time", async () => {
    const { week } = await source.periods();
    assert.equal(week.firstAchievementDaysMedian, null);
  });

  // 4 週前の週は 27〜21 日前の 7 日、その後の 3 週は 20 日前の 0 時から
  it("counts the accounts made 4 weeks ago that came back in the following 3 weeks", async () => {
    await addUser(day(27, 1), day(20, 1));
    await addUser(day(20, -1), day(20, -1));
    await addUser(noon(22), day(20, -1));
    // 4 週前の週の外
    await addUser(day(20, 1), noon(1));
    await addUser(day(27, -1), noon(1));
    assert.deepEqual(await source.retention(), { cohort: 3, retained: 1 });
  });

  // 90 日ちょうど（24 時間 × 90）は数える。使った人は 4 週間と同じ（27 日前の 0 時から）
  it("takes the median of each recent user's pending options 90 days old or older", async () => {
    const a = await addUser(noon(200), noon(1));
    for (const created of [ago(90 * DAY + 1), ago(90 * DAY - 1), noon(120)]) await addOption(a, created);
    await addOption(a, noon(150), { completed: true });
    await addUser(noon(200), noon(1));
    // 28 日の線のすぐ内側の人。抜けると [0, 2] で中央値が 1 になって落ちる
    const c = await addUser(noon(200), day(27, 1));
    for (let i = 0; i < 3; i++) await addOption(c, noon(100));
    // 直近 4 週間に使っていない人は数えない（入ると [0, 2, 3, 5] で 2.5 になる）
    const gone = await addUser(noon(300), day(27, -1));
    for (let i = 0; i < 5; i++) await addOption(gone, noon(200));
    // a は 2 件、もう 1 人は 0 件、c は 3 件
    assert.equal(await source.stalePendingMedian(), 2);
  });

  it("returns null for the stale median when nobody used it", async () => {
    assert.equal(await source.stalePendingMedian(), null);
  });

  it("counts client_error by the time it was received and lists the 3 most frequent messages of the last 4 weeks", async () => {
    for (const [message, at] of [
      ["a", noon(1)], ["a", noon(8)], ["a", noon(9)], ["b", noon(2)], ["b", noon(20)], ["c", day(6, 1)], ["d", day(6, -1)], ["e", day(27, -1)],
    ] as const) {
      await addEvent("client_error", message, at);
    }
    await addEvent("screen_view", "f", noon(1));
    const { week, fourWeeks } = await source.periods();
    assert.deepEqual([week.clientErrors, fourWeeks.clientErrors], [3, 7]);
    // c と d は 1 件ずつで並ぶので、メッセージの順で c が入る
    assert.deepEqual(await source.topClientErrors(), [
      { message: "a", count: 3 },
      { message: "b", count: 2 },
      { message: "c", count: 1 },
    ]);
  });

  it("shows a placeholder for client_error without a message", async () => {
    await addEvent("client_error", null, noon(1));
    assert.deepEqual(await source.topClientErrors(), [{ message: "（メッセージなし）", count: 1 }]);
  });

  it("cannot read the tables themselves as ol_metrics", async () => {
    await assert.rejects(metrics.query("SELECT count(*) FROM options"), { code: "42501" });
  });
});
