import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PgDatabase } from "../../src/infra/PgDatabase";
import { PgPoolFactory } from "../../src/infra/PgPoolFactory";
import { PromMetrics } from "../../src/metrics/PromMetrics";
import { TestApp } from "../fakes/TestApp";
import { TestDatabase } from "../fakes/TestDatabase";

// POST /api/events（api.md §2、data.md §3、testing.md §2）
const pool = new PgPoolFactory(process.env).create();
const data = new TestDatabase(pool);
const app = new TestApp({ db: new PgDatabase(pool, new PromMetrics()) }).build();
const event = { type: "client_error", payload: { message: "boom", route: "/suggestions/3" }, occurredAt: "2026-11-08T09:30:00.123+09:00" };

beforeEach(async () => {
  await data.reset();
});

afterAll(async () => {
  await data.reset();
  await pool.end();
});

describe("POST /api/events", () => {
  it("saves the events in one statement and answers 202 without a body", async () => {
    const res = await request(app).post("/api/events").send({ events: [event, { ...event, payload: { message: "second" } }] });
    expect(res.status).toBe(202);
    expect(res.text).toBe("");

    const { rows } = await pool.query("SELECT type, payload, occurred_at, received_at FROM events ORDER BY id");
    expect(rows).toEqual([
      { type: "client_error", payload: event.payload, occurred_at: new Date("2026-11-08T00:30:00.123Z"), received_at: expect.any(Date) },
      { type: "client_error", payload: { message: "second" }, occurred_at: new Date("2026-11-08T00:30:00.123Z"), received_at: expect.any(Date) },
    ]);
  });

  it.each([
    ["an unknown type", { events: [{ ...event, type: "screen_view" }] }],
    ["more than 50 events", { events: Array.from({ length: 51 }, () => event) }],
    ["a payload over 2KB", { events: [{ ...event, payload: { message: "a".repeat(2048) } }] }],
    ["occurredAt that is not a date", { events: [{ ...event, occurredAt: "yesterday" }] }],
  ])("returns 400 for %s and saves nothing", async (_, body) => {
    const res = await request(app).post("/api/events").send(body);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
    const { rows } = await pool.query("SELECT COUNT(*) AS n FROM events");
    expect(rows).toEqual([{ n: 0 }]);
  });
});
