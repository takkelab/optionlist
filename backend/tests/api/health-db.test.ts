import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { PgDatabase } from "../../src/infra/PgDatabase";
import { PgPoolFactory } from "../../src/infra/PgPoolFactory";
import { PromMetrics } from "../../src/metrics/PromMetrics";
import { FakeDatabase } from "../fakes/FakeDatabase";
import { FakeLogger } from "../fakes/FakeLogger";
import { TestApp } from "../fakes/TestApp";

// テスト用 DB（CI は PostgreSQL のサービスコンテナ、ローカルは backend/.env.test）を使う
const pool = new PgPoolFactory(process.env, console, "APP_DATABASE_URL").create();

afterAll(async () => {
  await pool.end();
});

// 使っていない接続が DB 側で切られると、pg のプールは error イベントを出す。受け手がないとプロセスが落ちる
describe("PgPoolFactory", () => {
  it("logs an error from an idle connection instead of crashing the process", async () => {
    const logger = new FakeLogger();
    const idle = new PgPoolFactory(process.env, logger, "APP_DATABASE_URL").create();
    const lost = new Error("terminating connection due to administrator command");
    try {
      expect(idle.emit("error", lost)).toBe(true);
      expect(logger.errors()).toEqual([lost]);
    } finally {
      await idle.end();
    }
  });
});

describe("GET /api/health/db", () => {
  it("returns ok and records the query time when the database is reachable", async () => {
    const metrics = new PromMetrics();
    const app = new TestApp({ db: new PgDatabase(pool, metrics), metrics }).build();

    const res = await request(app).get("/api/health/db");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });

    const { text } = await request(app).get("/api/metrics");
    expect(text).toMatch(/^db_query_duration_seconds_count 1$/m);
  });

  it("returns 503 when the database cannot be queried", async () => {
    const app = new TestApp({ db: new FakeDatabase(new Error("connect ECONNREFUSED")) }).build();
    const res = await request(app).get("/api/health/db");
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: "error", message: "connect ECONNREFUSED" });
  });
});
