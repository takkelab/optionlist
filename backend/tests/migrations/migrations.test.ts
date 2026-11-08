import { copyFileSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import mysql from "mysql2/promise";
import type { RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DbmateCli } from "../fakes/DbmateCli";
import { SchemaSnapshot } from "../fakes/SchemaSnapshot";

// testing.md §1。API テストと並列に走っても困らないよう、テスト用 DB とは別の DB（<テスト用 DB 名>_migrations）を使う
const MIGRATIONS_DIR = "db/migrations";
const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
// 提案の中身を入れ替えるマイグレーション（docs/decisions/0020）
const RESTRUCTURE = "20261103062436_restructure_suggestions.sql";
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL が未設定です。backend/.env.test.example を参考に .env.test を作ってください");
const url = new URL(process.env.DATABASE_URL);
const { pathname } = url;
const schema = `${pathname.slice(1)}_migrations`;
url.pathname = `/${schema}`;
const serverUrl = new URL(url);
serverUrl.pathname = "/";

const pool = mysql.createPool({ uri: serverUrl.toString(), connectionLimit: 2, timezone: "Z" });
const snapshot = new SchemaSnapshot(pool, schema);
const all = new DbmateCli(url.toString(), MIGRATIONS_DIR);
// 1 本ずつ up / down するために、マイグレーションを 1 本ずつ足していくフォルダ
const stepDir = mkdtempSync(join(tmpdir(), "optionlist-migrations-"));
const stepwise = new DbmateCli(url.toString(), stepDir);

afterAll(async () => {
  await all.drop();
  await pool.end();
  rmSync(stepDir, { recursive: true, force: true });
});

describe("all migrations", () => {
  beforeAll(async () => {
    await all.drop();
  });

  // 戻すのは 1 本ずつ dbmate を起動するので、マイグレーションの本数に比例して時間がかかる（9 本で 5 秒を超えることがある）
  it("run up -> down -> up on an empty database", async () => {
    await all.up();
    const first = await snapshot.take();
    for (let i = 0; i < files.length; i++) await all.rollback();
    expect(await snapshot.take()).toEqual({ columns: [], indexes: [], foreignKeys: [], rowCounts: [] });
    await all.up();
    expect(await snapshot.take()).toEqual(first);
  }, 60_000);
});

describe("each migration", () => {
  beforeAll(async () => {
    await all.drop();
  });

  // 前のケースの up が済んでいる前提で順に流す（vitest は 1 ファイル内のケースを順に実行する）
  it.each(files)("%s: down reverts what up changed", async (file) => {
    const state = await snapshot.take();
    copyFileSync(join(MIGRATIONS_DIR, file), join(stepDir, file));
    await stepwise.up();
    const applied = await snapshot.take();
    expect(applied).not.toEqual(state);
    await stepwise.rollback();
    expect(await snapshot.take()).toEqual(state);
    await stepwise.up();
  });
});

describe("replacing the suggestions", () => {
  const dir = mkdtempSync(join(tmpdir(), "optionlist-restructure-"));
  const migrator = new DbmateCli(url.toString(), dir);

  beforeAll(async () => {
    await all.drop();
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // 旧提案から追加した option は、手で追加したものとして残る（data.md §2）
  it("keeps the options of the old suggestions with suggestion_id set to NULL", async () => {
    for (const file of files.filter((f) => f < RESTRUCTURE)) copyFileSync(join(MIGRATIONS_DIR, file), join(dir, file));
    await migrator.up();
    await pool.query(
      `INSERT INTO ?? (title, status, suggestion_id, sort_order, created_at, updated_at) VALUES
       ('旧提案から', 'pending', 1, 0, NOW(3), NOW(3)), ('手で', 'completed', NULL, 1, NOW(3), NOW(3))`,
      [`${schema}.options`],
    );
    for (const file of files) copyFileSync(join(MIGRATIONS_DIR, file), join(dir, file));
    await migrator.up();

    const [rows] = await pool.query<RowDataPacket[]>("SELECT title, suggestion_id FROM ?? ORDER BY id", [`${schema}.options`]);
    expect(rows).toEqual([
      { title: "旧提案から", suggestion_id: null },
      { title: "手で", suggestion_id: null },
    ]);
  });

  // 前のケースで全部 up した状態から。新しい提案から追加した option があっても戻せ、つながりは外れる
  it("rolls back both migrations with an option added from a new suggestion", async () => {
    await pool.query("UPDATE ?? SET suggestion_id = 1 WHERE title = '手で'", [`${schema}.options`]);
    await migrator.rollback();
    await migrator.rollback();

    const [rows] = await pool.query<RowDataPacket[]>("SELECT title, suggestion_id FROM ?? ORDER BY id", [`${schema}.options`]);
    expect(rows).toEqual([
      { title: "旧提案から", suggestion_id: null },
      { title: "手で", suggestion_id: null },
    ]);
  });
});

describe("schema after all migrations", () => {
  beforeAll(async () => {
    await all.drop();
    await all.up();
  });

  it("has the tables and columns in data.md §2", async () => {
    const { columns } = await snapshot.take();
    expect(columns).toEqual([
      "achievements.id int unsigned NOT NULL auto_increment",
      "achievements.option_id int unsigned NOT NULL",
      "achievements.achieved_at datetime(3) NOT NULL",
      "achievements.photo_filename varchar(100) NULL",
      "events.id bigint unsigned NOT NULL auto_increment",
      "events.type varchar(50) NOT NULL",
      "events.payload json NOT NULL",
      "events.occurred_at datetime(3) NOT NULL",
      "events.received_at datetime(3) NOT NULL",
      "options.id int unsigned NOT NULL auto_increment",
      "options.title varchar(200) NOT NULL",
      "options.status enum('pending','completed') NOT NULL DEFAULT pending",
      "options.suggestion_id int unsigned NULL",
      "options.sort_order int NOT NULL",
      "options.planned_on date NULL",
      "options.completed_at datetime(3) NULL",
      "options.created_at datetime(3) NOT NULL",
      "options.updated_at datetime(3) NOT NULL",
      "suggestion_tags.suggestion_id int unsigned NOT NULL",
      "suggestion_tags.tag_id int unsigned NOT NULL",
      "suggestions.id int unsigned NOT NULL auto_increment",
      "suggestions.theme_id int unsigned NOT NULL",
      "suggestions.title varchar(200) NOT NULL",
      "suggestions.hook varchar(100) NOT NULL",
      "suggestions.trivia varchar(300) NOT NULL",
      "suggestions.first_step varchar(100) NOT NULL",
      "suggestions.size enum('hour','half_day','day','overnight') NOT NULL",
      "suggestions.season_from tinyint unsigned NULL",
      "suggestions.season_to tinyint unsigned NULL",
      "tags.id int unsigned NOT NULL auto_increment",
      "tags.name varchar(30) NOT NULL",
      "themes.id int unsigned NOT NULL auto_increment",
      "themes.name varchar(50) NOT NULL",
      "themes.sort_order int NOT NULL",
    ]);
  });

  it("has the indexes and foreign keys", async () => {
    const { indexes, foreignKeys } = await snapshot.take();
    expect(indexes).toEqual([
      "achievements.PRIMARY UNIQUE (id)",
      "achievements.idx_achievements_achieved_at (achieved_at)",
      "achievements.idx_achievements_option_id_achieved_at_photo (option_id,achieved_at,photo_filename)",
      "events.PRIMARY UNIQUE (id)",
      "events.idx_events_occurred_at (occurred_at)",
      "options.PRIMARY UNIQUE (id)",
      "options.idx_options_status_sort_order (status,sort_order)",
      "options.uq_options_suggestion_id UNIQUE (suggestion_id)",
      "suggestion_tags.PRIMARY UNIQUE (suggestion_id,tag_id)",
      "suggestion_tags.idx_suggestion_tags_tag_id (tag_id)",
      "suggestions.PRIMARY UNIQUE (id)",
      "suggestions.idx_suggestions_theme_id (theme_id)",
      "tags.PRIMARY UNIQUE (id)",
      "tags.uq_tags_name UNIQUE (name)",
      "themes.PRIMARY UNIQUE (id)",
    ]);
    expect(foreignKeys).toEqual([
      "achievements.option_id -> options.id ON DELETE CASCADE",
      // 指定しないと NO ACTION（InnoDB では RESTRICT と同じ）。提案は消さないので、参照されていても困らない
      "options.suggestion_id -> suggestions.id ON DELETE NO ACTION",
      "suggestion_tags.suggestion_id -> suggestions.id ON DELETE NO ACTION",
      "suggestion_tags.tag_id -> tags.id ON DELETE NO ACTION",
      "suggestions.theme_id -> themes.id ON DELETE NO ACTION",
    ]);
  });

  it("uses utf8mb4 for every table", async () => {
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT TABLE_NAME AS name, TABLE_COLLATION AS collation FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME <> 'schema_migrations'",
      [schema],
    );
    expect(rows).toHaveLength(7);
    expect(new Set(rows.map((r) => r.collation))).toEqual(new Set(["utf8mb4_0900_ai_ci"]));
  });

  // 季節は両方 NULL（通年）か、両方 1〜12（data.md §2）
  it.each([
    [1, null],
    [null, 12],
    [0, 3],
    [12, 13],
  ])("rejects the season %s - %s", async (from, to) => {
    const insert = pool.query(
      "INSERT INTO ?? (theme_id, title, hook, trivia, first_step, size, season_from, season_to) VALUES (1, 't', 'h', 'x', 'f', 'hour', ?, ?)",
      [`${schema}.suggestions`, from, to],
    );
    await expect(insert).rejects.toMatchObject({ code: "ER_CHECK_CONSTRAINT_VIOLATED" });
  });
});

describe("master data after all migrations", () => {
  // 件数は 100 件前後、テーマは 8〜10 個 ※仮決め（data.md §2）
  it("has about 100 suggestions in 8 to 10 themes, and every theme is used", async () => {
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT t.id, COUNT(s.id) AS n FROM ?? t LEFT JOIN ?? s ON s.theme_id = t.id GROUP BY t.id",
      [`${schema}.themes`, `${schema}.suggestions`],
    );
    const counts = rows.map((r) => Number(r.n));
    expect(counts.length).toBeGreaterThanOrEqual(8);
    expect(counts.length).toBeLessThanOrEqual(10);
    expect(Math.min(...counts)).toBeGreaterThan(0);
    const total = counts.reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThanOrEqual(80);
    expect(total).toBeLessThanOrEqual(120);
  });

  it("gives every suggestion 2 to 4 tags", async () => {
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT s.id, COUNT(st.tag_id) AS n FROM ?? s LEFT JOIN ?? st ON st.suggestion_id = s.id GROUP BY s.id HAVING n < 2 OR n > 4",
      [`${schema}.suggestions`, `${schema}.suggestion_tags`],
    );
    expect(rows).toEqual([]);
  });

  // 関連がつながるよう、1 つのタグは 3 件以上の提案に付ける（data.md §2）
  it("puts every tag on 3 or more suggestions", async () => {
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT t.name, COUNT(st.suggestion_id) AS n FROM ?? t LEFT JOIN ?? st ON st.tag_id = t.id GROUP BY t.id HAVING n < 3",
      [`${schema}.tags`, `${schema}.suggestion_tags`],
    );
    expect(rows).toEqual([]);
  });

  // 今月のおすすめ（screens.md §5）がどの月にも 5 件以上ある。季節は年をまたいでよい（12 → 2）
  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])("has 5 or more seasonal suggestions in month %i", async (month) => {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM ?? WHERE season_from IS NOT NULL AND (
         (season_from <= season_to AND ? BETWEEN season_from AND season_to)
         OR (season_from > season_to AND (? >= season_from OR ? <= season_to)))`,
      [`${schema}.suggestions`, month, month, month],
    );
    const [row] = rows;
    expect(Number(row?.n)).toBeGreaterThanOrEqual(5);
  });
});
