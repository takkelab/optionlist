import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { PgDatabase } from "../../src/infra/PgDatabase";
import { PgPoolFactory } from "../../src/infra/PgPoolFactory";
import { PromMetrics } from "../../src/metrics/PromMetrics";
import { FakeDatabase } from "../fakes/FakeDatabase";
import { TestApp } from "../fakes/TestApp";

// テスト用 DB（CI は PostgreSQL のサービスコンテナ、ローカルは backend/.env.test）を使う
const pool = new PgPoolFactory(process.env).create();

afterAll(async () => {
  await pool.end();
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
