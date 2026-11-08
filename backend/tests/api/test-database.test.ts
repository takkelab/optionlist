import { afterAll, describe, expect, it } from "vitest";
import { PgPoolFactory } from "../../src/infra/PgPoolFactory";
import { TestDatabase } from "../fakes/TestDatabase";
import { TestUsers } from "../fakes/TestUsers";

const pool = new PgPoolFactory(process.env, console, "DATABASE_URL").create();
const users = new TestUsers(pool);

afterAll(async () => {
  await pool.end();
});

describe("TestDatabase", () => {
  it("empties the data tables and keeps the master data", async () => {
    const database = new TestDatabase(pool);
    await database.reset();
    const now = new Date();
    await users.create();
    await pool.query("INSERT INTO options (user_id, title, sort_order, created_at, updated_at) VALUES (1, 'x', 0, $1, $1)", [now]);
    await pool.query("INSERT INTO achievements (option_id, user_id, achieved_at) VALUES (1, 1, $1)", [now]);
    await pool.query("INSERT INTO events (type, payload, occurred_at, received_at) VALUES ('client_error', '{}', $1, $1)", [now]);

    await database.reset();

    const { rows } = await pool.query(
      `SELECT (SELECT COUNT(*) FROM options) AS options, (SELECT COUNT(*) FROM users) AS users,
              (SELECT COUNT(*) FROM achievements) AS achievements, (SELECT COUNT(*) FROM events) AS events,
              (SELECT COUNT(*) FROM themes) AS themes, (SELECT COUNT(*) FROM tags) AS tags,
              (SELECT COUNT(*) FROM suggestions) AS suggestions, (SELECT COUNT(*) FROM suggestion_tags) AS "suggestionTags"`,
    );
    expect(rows[0]).toEqual({ options: 0, users: 0, achievements: 0, events: 0, themes: 10, tags: 39, suggestions: 95, suggestionTags: 281 });
  });

  it("restarts the ids so that tests can rely on them", async () => {
    const database = new TestDatabase(pool);
    await database.reset();
    const now = new Date();
    await users.create();
    await pool.query("INSERT INTO options (user_id, title, sort_order, created_at, updated_at) VALUES (1, 'x', 0, $1, $1)", [now]);
    await database.reset();
    await users.create();
    await pool.query("INSERT INTO options (user_id, title, sort_order, created_at, updated_at) VALUES (1, 'y', 0, $1, $1)", [now]);
    const { rows } = await pool.query("SELECT id FROM options");
    expect(rows.map((r) => r.id)).toEqual([1]);
    const { rows: userRows } = await pool.query("SELECT id FROM users");
    expect(userRows.map((r) => r.id)).toEqual([1]);
    await database.reset();
  });
});
