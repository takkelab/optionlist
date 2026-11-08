import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PgDatabase } from "../../src/infra/PgDatabase";
import { PgPoolFactory } from "../../src/infra/PgPoolFactory";
import { PromMetrics } from "../../src/metrics/PromMetrics";
import { OptionsApiClient } from "../fakes/OptionsApiClient";
import { TestApp } from "../fakes/TestApp";
import { TestDatabase } from "../fakes/TestDatabase";
import { TestUsers } from "../fakes/TestUsers";

// GET /api/options、GET /api/options/:id（api.md §2、testing.md §2）
// 前提の行は ol_migrator（pool）で入れ、アプリは ol_app（appPool）で動かす（testing.md §0）
const pool = new PgPoolFactory(process.env, console, "DATABASE_URL").create();
const appPool = new PgPoolFactory(process.env, console, "APP_DATABASE_URL").create();
const data = new TestDatabase(pool);
const users = new TestUsers(pool);
const app = new TestApp({ db: new PgDatabase(appPool, new PromMetrics()) }).build();
const VALIDATION_ERROR = { error: { code: "VALIDATION_ERROR" } };
// 各テストの人（reset で ID が 1 から振り直されるので、直接入れる行の user_id は 1）。beforeEach で Cookie を入れる
const api = new OptionsApiClient(app);

beforeEach(async () => {
  await data.reset();
  const { cookie } = await users.create();
  api.use(cookie);
});

afterAll(async () => {
  await data.reset();
  await Promise.all([pool.end(), appPool.end()]);
});

describe("GET /api/options", () => {
  it("lists pending options with a plan date first in date order (id order on the same day), then the others in sort order", async () => {
    await pool.query(
      `INSERT INTO options (id, user_id, title, status, sort_order, planned_on, created_at, updated_at) OVERRIDING SYSTEM VALUE VALUES
       (1, 1, 'a', 'pending', 2, '2026-11-23', '2026-11-01 00:00:00', '2026-11-01 00:00:00'),
       (2, 1, 'b', 'pending', 1, NULL, '2026-11-01 00:00:00', '2026-11-01 00:00:00'),
       (3, 1, 'c', 'completed', 0, NULL, '2026-11-01 00:00:00', '2026-11-01 00:00:00'),
       (4, 1, 'd', 'pending', 3, '2026-11-10', '2026-11-01 00:00:00', '2026-11-01 00:00:00'),
       (5, 1, 'e', 'pending', 0, '2026-11-23', '2026-11-01 00:00:00', '2026-11-01 00:00:00'),
       (6, 1, 'f', 'pending', -1, NULL, '2026-11-01 00:00:00', '2026-11-01 00:00:00')`,
    );
    await pool.query("INSERT INTO achievements (option_id, user_id, achieved_at) VALUES (1, 1, now()), (1, 1, now()), (3, 1, now())");

    const { status, body } = await api.list("?status=pending");
    expect(status).toBe(200);
    // 同じ日（1 と 5）は sort_order でなく id の順
    expect(body).toEqual([
      expect.objectContaining({ id: 4, plannedOn: "2026-11-10" }),
      expect.objectContaining({ id: 1, plannedOn: "2026-11-23", achievementCount: 2 }),
      expect.objectContaining({ id: 5 }),
      expect.objectContaining({ id: 6 }),
      {
        id: 2,
        title: "b",
        status: "pending",
        suggestionId: null,
        plannedOn: null,
        achievementCount: 0,
        latestPhotoUrl: null,
        completedAt: null,
        createdAt: "2026-11-01T00:00:00.000Z",
        updatedAt: "2026-11-01T00:00:00.000Z",
      },
    ]);
  });

  it("lists completed options with the newest completedAt first", async () => {
    await pool.query(
      `INSERT INTO options (id, user_id, title, status, sort_order, completed_at, created_at, updated_at) OVERRIDING SYSTEM VALUE VALUES
       (1, 1, 'old', 'completed', 0, '2026-10-01 00:00:00', now(), now()),
       (2, 1, 'new', 'completed', 0, '2026-10-02 00:00:00', now(), now()),
       (3, 1, 'p', 'pending', 0, NULL, now(), now())`,
    );
    const { body } = await api.list("?status=completed");
    expect(body).toMatchObject([
      { title: "new", completedAt: "2026-10-02T00:00:00.000Z" },
      { title: "old", completedAt: "2026-10-01T00:00:00.000Z" },
    ]);
  });

  it.each(["", "?status=done"])("returns 400 for the query %j", async (query) => {
    const { status, body } = await api.list(query);
    expect(status).toBe(400);
    expect(body).toMatchObject(VALIDATION_ERROR);
  });
});

describe("GET /api/options/:id", () => {
  it("returns the option with its plan date and achievements in time order", async () => {
    await pool.query(
      `INSERT INTO options (id, user_id, title, sort_order, planned_on, created_at, updated_at) OVERRIDING SYSTEM VALUE VALUES
       (1, 1, 'a', 0, '2026-11-23', now(), now()), (2, 1, 'b', 1, NULL, now(), now())`,
    );
    await pool.query("INSERT INTO achievements (id, option_id, user_id, achieved_at) OVERRIDING SYSTEM VALUE VALUES (1, 1, 1, '2026-11-01 00:00:05')");

    const { status, body } = await api.detail(1);
    expect(status).toBe(200);
    expect(body).toMatchObject({
      id: 1,
      title: "a",
      plannedOn: "2026-11-23",
      achievementCount: 1,
      achievements: [{ id: 1, optionId: 1, achievedAt: "2026-11-01T00:00:05.000Z", photoUrl: null }],
      firstStep: null,
    });
    expect(body).not.toHaveProperty("first_step");
  });

  it("returns the first step of the suggestion it was added from", async () => {
    await pool.query(
      "INSERT INTO options (id, user_id, title, suggestion_id, sort_order, created_at, updated_at) OVERRIDING SYSTEM VALUE VALUES (1, 1, 'a', 10, 0, now(), now())",
    );
    const { rows } = await pool.query("SELECT first_step FROM suggestions WHERE id = 10");
    const [row] = rows;

    const { status, body } = await api.detail(1);
    expect(status).toBe(200);
    expect(body).toMatchObject({ suggestionId: 10, firstStep: row?.first_step });
  });

  it.each(["999", "abc"])("returns 404 for the id %s", async (id) => {
    const { status, body } = await api.detail(id);
    expect(status).toBe(404);
    expect(body).toMatchObject({ error: { code: "NOT_FOUND" } });
  });
});
