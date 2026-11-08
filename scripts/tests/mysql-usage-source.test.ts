import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { parseEnv } from "node:util";
import { createPool } from "mysql2/promise";
import type { ResultSetHeader } from "mysql2/promise";
import { MySqlUsageSource } from "../lib/mysql-usage-source.ts";

// metrics:usage の SQL を、テスト用 DB（backend/.env.test。CI では test:scripts の前にマイグレーションする）で確かめる
const ENV_FILE = resolve(import.meta.dirname, "../../backend/.env.test");
const { DATABASE_URL: url } = parseEnv(readFileSync(ENV_FILE, "utf8"));
if (url === undefined) throw new Error(`${ENV_FILE} に DATABASE_URL がない`);
const pool = createPool({ uri: url, timezone: "Z" });
const source = new MySqlUsageSource(pool);

// 期間は [FROM, TO)。境界ちょうどの行と、1ms 外の行を入れる
const FROM = new Date("2026-11-01T00:00:00.000Z");
const TO = new Date("2026-11-08T00:00:00.000Z");
const before1ms = (date: Date) => new Date(date.getTime() - 1);

// option を入れて id を返す
const addOption = async (createdAt: Date, extra: { suggestionId?: number; completed?: boolean } = {}): Promise<number> => {
  const status = extra.completed === true ? "completed" : "pending";
  const [result] = await pool.query<ResultSetHeader>(
    "INSERT INTO options (title, status, suggestion_id, sort_order, completed_at, created_at, updated_at) VALUES ('x', ?, ?, 0, ?, ?, ?)",
    [status, extra.suggestionId ?? null, extra.completed === true ? createdAt : null, createdAt, createdAt],
  );
  return result.insertId;
};
const achieve = (optionId: number, at: Date) => pool.query("INSERT INTO achievements (option_id, achieved_at) VALUES (?, ?)", [optionId, at]);
const addEvent = (type: string, message: string, at: Date) =>
  pool.query("INSERT INTO events (type, payload, occurred_at, received_at) VALUES (?, ?, ?, ?)", [type, JSON.stringify({ message, route: "/" }), at, at]);

const clear = async () => {
  for (const table of ["achievements", "events", "options"]) await pool.query("DELETE FROM ??", [table]);
};

describe("MySqlUsageSource", () => {
  before(clear);
  beforeEach(clear);
  after(async () => {
    await clear();
    await pool.end();
  });

  it("counts achievements in [from, to)", async () => {
    const id = await addOption(before1ms(FROM));
    for (const at of [before1ms(FROM), FROM, before1ms(TO), TO]) await achieve(id, at);
    assert.equal(await source.achievements(FROM, TO), 2);
  });

  it("counts options added from a suggestion in [from, to), but not the ones added by hand", async () => {
    await addOption(FROM, { suggestionId: 1 });
    await addOption(FROM);
    await addOption(TO, { suggestionId: 2 });
    await addOption(before1ms(FROM), { suggestionId: 3 });
    assert.equal(await source.suggestionAdds(FROM, TO), 1);
  });

  it("measures only the options whose very first achievement falls in [from, to)", async () => {
    const early = await addOption(new Date("2026-10-30T00:00:00.000Z"));
    await achieve(early, before1ms(FROM));
    await achieve(early, new Date("2026-11-03T00:00:00.000Z"));
    const fresh = await addOption(FROM);
    await achieve(fresh, new Date("2026-11-02T00:00:00.000Z"));
    await achieve(fresh, new Date("2026-11-05T00:00:00.000Z"));
    // 最初の達成が境界ちょうど: FROM は入り、TO は入らない
    const atFrom = await addOption(before1ms(FROM));
    await achieve(atFrom, FROM);
    const atTo = await addOption(FROM);
    await achieve(atTo, TO);
    const seconds = await source.firstAchievementSeconds(FROM, TO);
    assert.deepEqual(seconds.toSorted((a, b) => a - b), [0, 86_400]);
  });

  it("counts pending options made before the date, not completed ones", async () => {
    await addOption(before1ms(FROM));
    await addOption(before1ms(FROM), { completed: true });
    await addOption(FROM);
    assert.equal(await source.stalePending(FROM), 1);
  });

  it("groups client_error by message in [from, to), most frequent first", async () => {
    await addEvent("client_error", "b", FROM);
    await addEvent("client_error", "a", FROM);
    await addEvent("client_error", "a", before1ms(TO));
    await addEvent("client_error", "a", TO);
    await addEvent("client_error", "c", before1ms(FROM));
    await addEvent("screen_view", "d", FROM);
    assert.deepEqual(await source.clientErrors(FROM, TO), [
      { message: "a", count: 2 },
      { message: "b", count: 1 },
    ]);
  });
});
