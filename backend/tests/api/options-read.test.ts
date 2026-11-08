import type { RowDataPacket } from "mysql2/promise";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { MySqlDatabase } from "../../src/infra/MySqlDatabase";
import { MySqlPoolFactory } from "../../src/infra/MySqlPoolFactory";
import { PromMetrics } from "../../src/metrics/PromMetrics";
import { OptionsApiClient } from "../fakes/OptionsApiClient";
import { TestApp } from "../fakes/TestApp";
import { TestDatabase } from "../fakes/TestDatabase";

// GET /api/options、GET /api/options/:id（api.md §2、testing.md §2）
const pool = new MySqlPoolFactory(process.env).create();
const data = new TestDatabase(pool);
const api = new OptionsApiClient(new TestApp({ db: new MySqlDatabase(pool, new PromMetrics()) }).build());
const VALIDATION_ERROR = { error: { code: "VALIDATION_ERROR" } };

beforeEach(async () => {
  await data.reset();
});

afterAll(async () => {
  await data.reset();
  await pool.end();
});

describe("GET /api/options", () => {
  it("lists pending options with a plan date first in date order (id order on the same day), then the others in sort order", async () => {
    await pool.query(
      `INSERT INTO options (id, title, status, sort_order, planned_on, created_at, updated_at) VALUES
       (1, 'a', 'pending', 2, '2026-11-23', '2026-11-01 00:00:00', '2026-11-01 00:00:00'),
       (2, 'b', 'pending', 1, NULL, '2026-11-01 00:00:00', '2026-11-01 00:00:00'),
       (3, 'c', 'completed', 0, NULL, '2026-11-01 00:00:00', '2026-11-01 00:00:00'),
       (4, 'd', 'pending', 3, '2026-11-10', '2026-11-01 00:00:00', '2026-11-01 00:00:00'),
       (5, 'e', 'pending', 0, '2026-11-23', '2026-11-01 00:00:00', '2026-11-01 00:00:00'),
       (6, 'f', 'pending', -1, NULL, '2026-11-01 00:00:00', '2026-11-01 00:00:00')`,
    );
    await pool.query("INSERT INTO achievements (option_id, achieved_at) VALUES (1, NOW(3)), (1, NOW(3)), (3, NOW(3))");

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
      `INSERT INTO options (id, title, status, sort_order, completed_at, created_at, updated_at) VALUES
       (1, 'old', 'completed', 0, '2026-10-01 00:00:00', NOW(3), NOW(3)),
       (2, 'new', 'completed', 0, '2026-10-02 00:00:00', NOW(3), NOW(3)),
       (3, 'p', 'pending', 0, NULL, NOW(3), NOW(3))`,
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
      `INSERT INTO options (id, title, sort_order, planned_on, created_at, updated_at) VALUES
       (1, 'a', 0, '2026-11-23', NOW(3), NOW(3)), (2, 'b', 1, NULL, NOW(3), NOW(3))`,
    );
    await pool.query("INSERT INTO achievements (id, option_id, achieved_at) VALUES (1, 1, '2026-11-01 00:00:05')");

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
      "INSERT INTO options (id, title, suggestion_id, sort_order, created_at, updated_at) VALUES (1, 'a', 10, 0, NOW(3), NOW(3))",
    );
    const [rows] = await pool.query<RowDataPacket[]>("SELECT first_step FROM suggestions WHERE id = 10");
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
