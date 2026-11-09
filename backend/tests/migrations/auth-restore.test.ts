import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DbmateCli } from "../fakes/DbmateCli";
import { ShortLivedConnection } from "../fakes/ShortLivedConnection";

// 認証の関数のうち auth_restore の振る舞い（data.md §4、testing.md §1）。rls.test.ts と同じ <テスト用 DB 名>_migrations を作り直して使う
if (!process.env.DATABASE_URL || !process.env.APP_DATABASE_URL) {
  throw new Error("DATABASE_URL・APP_DATABASE_URL が未設定です。backend/.env.test.example を参考に .env.test を作ってください");
}
const migratorUrl = new URL(process.env.DATABASE_URL);
migratorUrl.pathname = `${migratorUrl.pathname}_migrations`;
const appUrl = new URL(process.env.APP_DATABASE_URL);
appUrl.pathname = migratorUrl.pathname;

const sql = new ShortLivedConnection(migratorUrl.toString());
const migrator = new DbmateCli(migratorUrl.toString(), "db/migrations");
await migrator.drop();
await migrator.up();

afterAll(async () => {
  await migrator.drop();
});

// 復旧コードで移る（data.md §4 の auth_restore、api.md §6）。429 で断った試行は数えない（docs/decisions/0049）
describe("auth_restore", () => {
  const app = new pg.Client({ connectionString: appUrl.toString() });
  type RestoreRow = { status: string; user_id: string | null; retry_after_seconds: number | null; local_item_count: number | null };
  // 持ち主（コードの人）、項目がある別の人、項目がない別の人
  const ids = { owner: "", withItems: "", empty: "" };

  const restore = async (code: string, session: string, ip: string, current: string | null, replace = false): Promise<RestoreRow> => {
    const { rows } = await app.query(
      "SELECT status, user_id, retry_after_seconds, local_item_count FROM auth_restore($1, $2, $3, $4, $5)",
      [Buffer.from(code), Buffer.from(session), Buffer.from(ip), current, replace],
    );
    const [row] = rows as RestoreRow[];
    if (row === undefined) throw new Error("auth_restore が行を返さなかった");
    return row;
  };
  const userOf = async (id: string) => {
    const [row] = await sql.rows<{ session: string; code: string | null }>(
      "SELECT convert_from(session_hash, 'UTF8') AS session, convert_from(recovery_code_hash, 'UTF8') AS code FROM users WHERE id = $1",
      [id],
    );
    return row;
  };
  const attempts = async (ip: string) => {
    const [row] = await sql.rows<{ n: number }>("SELECT count(*)::int AS n FROM auth_attempts WHERE kind = 'restore' AND ip_hash = $1", [Buffer.from(ip)]);
    return row?.n;
  };
  const insertUser = async (session: string, code: string | null): Promise<string> => {
    const [row] = await sql.rows<{ id: string }>(
      "INSERT INTO users (session_hash, recovery_code_hash, created_at, last_seen_at) VALUES ($1, $2, now(), now()) RETURNING id",
      [Buffer.from(session), code === null ? null : Buffer.from(code)],
    );
    return row?.id ?? "";
  };

  beforeAll(async () => {
    ids.owner = await insertUser("r-owner", "code-1");
    ids.withItems = await insertUser("r-items", null);
    ids.empty = await insertUser("r-empty", null);
    await sql.rows("INSERT INTO options (user_id, title, sort_order, created_at, updated_at) VALUES ($1, 'x', 0, now(), now()), ($1, 'y', 1, now(), now())", [
      ids.withItems,
    ]);
    await app.connect();
  });

  afterAll(async () => {
    await app.end();
  });

  it("answers not_found for an unknown code and counts the attempt", async () => {
    expect(await restore("no-such-code", "s", "ip-a", null)).toMatchObject({ status: "not_found", user_id: null });
    expect(await attempts("ip-a")).toBe(1);
  });

  it("asks to confirm without using the code when this device has another account with items", async () => {
    expect(await restore("code-1", "s-new", "ip-a", ids.withItems)).toMatchObject({ status: "needs_confirm", local_item_count: 2 });
    expect(await userOf(ids.owner)).toEqual({ session: "r-owner", code: "code-1" });
    expect(await attempts("ip-a")).toBe(2);
  });

  it("moves with replace and makes the code unusable", async () => {
    expect(await restore("code-1", "s-moved", "ip-a", ids.withItems, true)).toEqual({
      status: "ok",
      user_id: ids.owner,
      retry_after_seconds: null,
      local_item_count: null,
    });
    expect(await userOf(ids.owner)).toEqual({ session: "s-moved", code: null });
    expect(await restore("code-1", "s-again", "ip-a", null)).toMatchObject({ status: "not_found" });
  });

  it("moves without confirming when the other account on this device is empty, or it is the same account", async () => {
    await sql.rows("UPDATE users SET recovery_code_hash = $2 WHERE id = $1", [ids.owner, Buffer.from("code-2")]);
    expect(await restore("code-2", "s-from-empty", "ip-b", ids.empty)).toMatchObject({ status: "ok", user_id: ids.owner });
    await sql.rows("UPDATE users SET recovery_code_hash = $2 WHERE id = $1", [ids.owner, Buffer.from("code-3")]);
    expect(await restore("code-3", "s-self", "ip-b", ids.owner)).toMatchObject({ status: "ok", user_id: ids.owner });
    expect(await userOf(ids.owner)).toEqual({ session: "s-self", code: null });
  });

  // 1 つの IP から 1 時間に 10 回まで。合っているコードでも上限なら rate_limited で、コードは使わない
  it("answers rate_limited after 10 attempts from one IP, also for the right code, without counting it", async () => {
    for (let i = 0; i < 10; i++) expect(await restore(`wrong-${i}`, "s", "ip-c", null)).toMatchObject({ status: "not_found" });
    await sql.rows("UPDATE users SET recovery_code_hash = $2 WHERE id = $1", [ids.owner, Buffer.from("code-4")]);
    const limited = await restore("code-4", "s-limited", "ip-c", null);
    expect(limited).toMatchObject({ status: "rate_limited", user_id: null });
    expect(limited.retry_after_seconds).toBeGreaterThanOrEqual(3500);
    expect(limited.retry_after_seconds).toBeLessThanOrEqual(3600);
    expect(await userOf(ids.owner)).toEqual({ session: "s-self", code: "code-4" });
    expect(await attempts("ip-c")).toBe(10);
    expect(await restore("code-4", "s-other-ip", "ip-d", null)).toMatchObject({ status: "ok" });
  });

  // 断った試行が窓を延ばさないので、いちばん古い 1 件が 1 時間の外に出たら 1 回だけまた試せる
  it("lets the IP try once more when the oldest attempt leaves the hour", async () => {
    await sql.rows(
      `UPDATE auth_attempts SET occurred_at = now() - interval '61 minutes'
        WHERE id = (SELECT min(id) FROM auth_attempts WHERE kind = 'restore' AND ip_hash = $1)`,
      [Buffer.from("ip-c")],
    );
    expect(await restore("wrong-x", "s", "ip-c", null)).toMatchObject({ status: "not_found" });
    expect(await restore("wrong-y", "s", "ip-c", null)).toMatchObject({ status: "rate_limited" });
  });
});
