import type { RowDataPacket } from "mysql2/promise";
import { afterAll, describe, expect, it } from "vitest";
import { PerfDataGenerator, SeededRandom, TestDatabaseGuard } from "../../db/perf-data/PerfDataGenerator";
import type { PerfDataCounts } from "../../db/perf-data/PerfDataGenerator";
import { MySqlDatabase } from "../../src/infra/MySqlDatabase";
import { MySqlPoolFactory } from "../../src/infra/MySqlPoolFactory";
import { PromMetrics } from "../../src/metrics/PromMetrics";
import { TestDatabase } from "../fakes/TestDatabase";

// 本番の件数（metrics.md §1）は npm run db:perf-data で入れる。ここでは小さい件数で中身を確かめる
const COUNTS: PerfDataCounts = {
  pendingOptions: 3,
  completedOptions: 2,
  achievements: 7,
  events: 9,
};

const pool = new MySqlPoolFactory(process.env).create();
const db = new MySqlDatabase(pool, new PromMetrics());

afterAll(async () => {
  await new TestDatabase(pool).reset();
  await pool.end();
});

describe("PerfDataGenerator", () => {
  it("inserts the configured number of rows", async () => {
    await new PerfDataGenerator(db, COUNTS, new SeededRandom(1), new Date()).generate();
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT (SELECT COUNT(*) FROM options WHERE status = 'pending' AND completed_at IS NULL) AS pending,
              (SELECT COUNT(*) FROM options WHERE status = 'completed' AND completed_at IS NOT NULL) AS completed,
              (SELECT COUNT(*) FROM achievements) AS achievements,
              (SELECT COUNT(*) FROM events) AS events, (SELECT COUNT(*) FROM suggestions) AS suggestions`,
    );
    expect(rows[0]).toEqual({ pending: 3, completed: 2, achievements: 7, events: 9, suggestions: 95 });
  });

  // 一覧・1 件の API で、追加済みの印を付ける行と付けない行の両方を測る
  it("adds 50 suggestions to the options and leaves the rest unadded", async () => {
    const counts = { ...COUNTS, pendingOptions: 60, completedOptions: 60 };
    await new PerfDataGenerator(db, counts, new SeededRandom(1), new Date()).generate();
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT (SELECT COUNT(*) FROM options WHERE suggestion_id IS NOT NULL) AS added,
              (SELECT COUNT(*) FROM suggestions s WHERE NOT EXISTS (SELECT 1 FROM options o WHERE o.suggestion_id = s.id)) AS unadded`,
    );
    expect(rows[0]).toEqual({ added: 50, unadded: 45 });
  });

  // 送るイベントは client_error だけ（screens.md §8、docs/decisions/0031）
  it("inserts client_error events with the message and the screen", async () => {
    await new PerfDataGenerator(db, { ...COUNTS, events: 8 }, new SeededRandom(1), new Date()).generate();
    const [types] = await pool.query<RowDataPacket[]>("SELECT DISTINCT type FROM events");
    expect(types.map((r) => r.type)).toEqual(["client_error"]);
    const [errors] = await pool.query<RowDataPacket[]>("SELECT payload FROM events");
    for (const { payload } of errors) expect(payload).toEqual({ message: expect.any(String), route: expect.any(String) });
    const routes = new Set(errors.map(({ payload }) => payload.route));
    expect([...routes].sort()).toEqual(["/", "/done", "/suggestions", "/suggestions/12"]);
  });

  it("replaces the previous data instead of adding to it", async () => {
    const generator = new PerfDataGenerator(db, COUNTS, new SeededRandom(1), new Date());
    await generator.generate();
    await generator.generate();
    const [rows] = await pool.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM options");
    expect(rows[0]).toEqual({ n: 5 });
  });

});

describe("SeededRandom", () => {
  it("returns the same sequence for the same seed, within [0, 1)", () => {
    const a = new SeededRandom(42);
    const b = new SeededRandom(42);
    const values = [a.next(), a.next(), a.next()];
    expect([b.next(), b.next(), b.next()]).toEqual(values);
    expect(values.every((v) => v >= 0 && v < 1)).toBe(true);
  });
});

describe("TestDatabaseGuard", () => {
  it("allows only databases whose name ends with _test", () => {
    const guard = new TestDatabaseGuard();
    expect(() => guard.ensureSafe("mysql://root:@localhost:3306/optionlist_test")).not.toThrow();
    expect(() => guard.ensureSafe("mysql://root:@localhost:3306/optionlist")).toThrow("_test で終わる");
    expect(() => guard.ensureSafe(undefined)).toThrow("_test で終わる");
  });
});
