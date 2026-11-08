import { afterAll, describe, expect, it } from "vitest";
import { PgPoolFactory } from "../../src/infra/PgPoolFactory";
import { TestDatabase } from "../fakes/TestDatabase";

const pool = new PgPoolFactory(process.env, console).create();

afterAll(async () => {
  await pool.end();
});

describe("TestDatabase", () => {
  it("empties the data tables and keeps the master data", async () => {
    const database = new TestDatabase(pool);
    await database.reset();
    const now = new Date();
    await pool.query("INSERT INTO options (title, sort_order, created_at, updated_at) VALUES ('x', 0, $1, $1)", [now]);
    await pool.query("INSERT INTO achievements (option_id, achieved_at) VALUES (1, $1)", [now]);
    await pool.query("INSERT INTO events (type, payload, occurred_at, received_at) VALUES ('client_error', '{}', $1, $1)", [now]);

    await database.reset();

    const { rows } = await pool.query(
      `SELECT (SELECT COUNT(*) FROM options) AS options,
              (SELECT COUNT(*) FROM achievements) AS achievements, (SELECT COUNT(*) FROM events) AS events,
              (SELECT COUNT(*) FROM themes) AS themes, (SELECT COUNT(*) FROM tags) AS tags,
              (SELECT COUNT(*) FROM suggestions) AS suggestions, (SELECT COUNT(*) FROM suggestion_tags) AS "suggestionTags"`,
    );
    expect(rows[0]).toEqual({ options: 0, achievements: 0, events: 0, themes: 10, tags: 39, suggestions: 95, suggestionTags: 281 });
  });

  it("restarts the ids so that tests can rely on them", async () => {
    const database = new TestDatabase(pool);
    await database.reset();
    const now = new Date();
    await pool.query("INSERT INTO options (title, sort_order, created_at, updated_at) VALUES ('x', 0, $1, $1)", [now]);
    await database.reset();
    await pool.query("INSERT INTO options (title, sort_order, created_at, updated_at) VALUES ('y', 0, $1, $1)", [now]);
    const { rows } = await pool.query("SELECT id FROM options");
    expect(rows.map((r) => r.id)).toEqual([1]);
    await database.reset();
  });
});
