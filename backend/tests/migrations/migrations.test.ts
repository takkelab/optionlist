import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DbmateCli } from "../fakes/DbmateCli";
import { SchemaSnapshot } from "../fakes/SchemaSnapshot";
import { ShortLivedConnection } from "../fakes/ShortLivedConnection";

// testing.md §1。API テストと並列に走っても困らないよう、テスト用 DB とは別の DB（<テスト用 DB 名>_migrations）を使う
const MIGRATIONS_DIR = "db/migrations";
const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
// MySQL 時代の最後の提案のマスターデータ（docs/decisions/0044・0047）
const FIXTURE = "tests/migrations/fixtures/suggestions-mysql-final.json";
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL が未設定です。backend/.env.test.example を参考に .env.test を作ってください");
const url = new URL(process.env.DATABASE_URL);
url.pathname = `${url.pathname}_migrations`;

const sql = new ShortLivedConnection(url.toString());
const snapshot = new SchemaSnapshot(sql);
const all = new DbmateCli(url.toString(), MIGRATIONS_DIR);
// 1 本ずつ up / down するために、マイグレーションを 1 本ずつ足していくフォルダ
const stepDir = mkdtempSync(join(tmpdir(), "optionlist-migrations-"));
const stepwise = new DbmateCli(url.toString(), stepDir);

// DB を消して作り直す前準備。手元で npm test の直後に流すと 10 秒（既定）を超えることがある
const HOOK_TIMEOUT_MS = 60_000;
const EMPTY = { columns: [], indexes: [], foreignKeys: [], checks: [], functions: [], views: [], privileges: [], rowCounts: [] };

afterAll(async () => {
  await all.drop();
  rmSync(stepDir, { recursive: true, force: true });
});

// 版（ファイル名の先頭の日時。UTC）を手で未来の時刻にすると、あとで db:new が付ける今の時刻の版がその前に並び、
// 新しいマイグレーションが古いものより先に流れる（docs/harness/incidents.md #21）
describe("migration versions", () => {
  it.each(files)("%s is not dated in the future", (file) => {
    const version = file.slice(0, 14);
    const now = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
    expect(version <= now).toBe(true);
  });
});

describe("all migrations", () => {
  beforeAll(async () => {
    await all.drop();
  }, HOOK_TIMEOUT_MS);

  it("run up -> down -> up on an empty database", async () => {
    await all.up();
    const first = await snapshot.take();
    for (let i = 0; i < files.length; i++) await all.rollback();
    expect(await snapshot.take()).toEqual(EMPTY);
    await all.up();
    expect(await snapshot.take()).toEqual(first);
  }, 60_000);
});

describe("each migration", () => {
  // 1 本目の up の前の状態を読めるよう、空の DB を作っておく（dbmate up は DB がなければ作るが、その前に読むため）
  beforeAll(async () => {
    await all.drop();
    await all.create();
  }, HOOK_TIMEOUT_MS);

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
    // スナップショットを 3 回取り、dbmate を 3 回動かす。手元で全体を流すと 5 秒（既定）を超える（単独では 3〜4 秒）
  }, 30_000);
});

describe("schema after all migrations", () => {
  beforeAll(async () => {
    await all.drop();
    await all.up();
  }, HOOK_TIMEOUT_MS);

  it("has the tables and columns in data.md §2", async () => {
    const { columns } = await snapshot.take();
    expect(columns).toEqual([
      "achievements.id bigint NOT NULL GENERATED ALWAYS AS IDENTITY",
      "achievements.option_id bigint NOT NULL",
      "achievements.achieved_at timestamp(3) with time zone NOT NULL",
      "achievements.photo_filename character varying(100) NULL",
      "achievements.user_id bigint NOT NULL",
      "achievements.photo_bytes integer NULL",
      "auth_attempts.id bigint NOT NULL GENERATED ALWAYS AS IDENTITY",
      "auth_attempts.kind text NOT NULL",
      "auth_attempts.ip_hash bytea NOT NULL",
      "auth_attempts.occurred_at timestamp(3) with time zone NOT NULL",
      "events.id bigint NOT NULL GENERATED ALWAYS AS IDENTITY",
      "events.type character varying(50) NOT NULL",
      "events.payload jsonb NOT NULL",
      "events.occurred_at timestamp(3) with time zone NOT NULL",
      "events.received_at timestamp(3) with time zone NOT NULL",
      "options.id bigint NOT NULL GENERATED ALWAYS AS IDENTITY",
      "options.title character varying(200) NOT NULL",
      "options.status text NOT NULL DEFAULT 'pending'::text",
      "options.suggestion_id bigint NULL",
      "options.sort_order integer NOT NULL",
      "options.planned_on date NULL",
      "options.completed_at timestamp(3) with time zone NULL",
      "options.created_at timestamp(3) with time zone NOT NULL",
      "options.updated_at timestamp(3) with time zone NOT NULL",
      "options.user_id bigint NOT NULL",
      "suggestion_tags.suggestion_id bigint NOT NULL",
      "suggestion_tags.tag_id bigint NOT NULL",
      "suggestions.id bigint NOT NULL GENERATED ALWAYS AS IDENTITY",
      "suggestions.theme_id bigint NOT NULL",
      "suggestions.title character varying(200) NOT NULL",
      "suggestions.hook character varying(100) NOT NULL",
      "suggestions.trivia character varying(300) NOT NULL",
      "suggestions.first_step character varying(100) NOT NULL",
      "suggestions.size text NOT NULL",
      "suggestions.season_from smallint NULL",
      "suggestions.season_to smallint NULL",
      "tags.id bigint NOT NULL GENERATED ALWAYS AS IDENTITY",
      "tags.name character varying(30) NOT NULL",
      "themes.id bigint NOT NULL GENERATED ALWAYS AS IDENTITY",
      "themes.name character varying(50) NOT NULL",
      "themes.sort_order integer NOT NULL",
      "users.id bigint NOT NULL GENERATED ALWAYS AS IDENTITY",
      "users.session_hash bytea NOT NULL",
      "users.recovery_code_hash bytea NULL",
      "users.created_at timestamp(3) with time zone NOT NULL",
      "users.last_seen_at timestamp(3) with time zone NOT NULL",
    ]);
  });

  it("has the indexes, foreign keys and checks", async () => {
    const { indexes, foreignKeys, checks } = await snapshot.take();
    expect(indexes).toEqual([
      "achievements.achievements_pkey UNIQUE (id)",
      "achievements.idx_achievements_achieved_at (achieved_at)",
      "achievements.idx_achievements_option_id_achieved_at_photo (option_id, achieved_at, photo_filename)",
      "achievements.idx_achievements_user_id (user_id)",
      "achievements.uq_achievements_photo_filename UNIQUE (photo_filename)",
      "auth_attempts.auth_attempts_pkey UNIQUE (id)",
      "auth_attempts.idx_auth_attempts_kind_ip_hash_occurred_at (kind, ip_hash, occurred_at)",
      "events.events_pkey UNIQUE (id)",
      "events.idx_events_occurred_at (occurred_at)",
      "options.idx_options_user_id_status_completed_at (user_id, status, completed_at)",
      "options.idx_options_user_id_status_sort_order (user_id, status, sort_order)",
      "options.options_pkey UNIQUE (id)",
      "options.uq_options_id_user_id UNIQUE (id, user_id)",
      "options.uq_options_user_id_suggestion_id UNIQUE (user_id, suggestion_id)",
      "suggestion_tags.idx_suggestion_tags_tag_id (tag_id)",
      "suggestion_tags.suggestion_tags_pkey UNIQUE (suggestion_id, tag_id)",
      "suggestions.idx_suggestions_theme_id (theme_id)",
      "suggestions.suggestions_pkey UNIQUE (id)",
      "tags.tags_pkey UNIQUE (id)",
      "tags.uq_tags_name UNIQUE (name)",
      "themes.themes_pkey UNIQUE (id)",
      "users.idx_users_last_seen_at (last_seen_at)",
      "users.uq_users_recovery_code_hash UNIQUE (recovery_code_hash)",
      "users.uq_users_session_hash UNIQUE (session_hash)",
      "users.users_pkey UNIQUE (id)",
    ]);
    // ON DELETE を書かないと NO ACTION。提案は消さないので、参照されていても困らない
    // 達成は (option_id, user_id) の複合外部キーで、項目の持ち主と必ず同じ人になる（data.md §2）
    expect(foreignKeys).toEqual([
      "achievements.fk_achievements_option_user FOREIGN KEY (option_id, user_id) REFERENCES options(id, user_id) ON DELETE CASCADE",
      "options.fk_options_suggestion FOREIGN KEY (suggestion_id) REFERENCES suggestions(id)",
      "options.fk_options_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE",
      "suggestion_tags.fk_suggestion_tags_suggestion FOREIGN KEY (suggestion_id) REFERENCES suggestions(id)",
      "suggestion_tags.fk_suggestion_tags_tag FOREIGN KEY (tag_id) REFERENCES tags(id)",
      "suggestions.fk_suggestions_theme FOREIGN KEY (theme_id) REFERENCES themes(id)",
    ]);
    // MySQL の ENUM の代わりに text と CHECK で値を決める（data.md §2）
    expect(checks).toEqual([
      "achievements.chk_achievements_photo_bytes CHECK ((((photo_filename IS NULL) AND (photo_bytes IS NULL)) OR ((photo_filename IS NOT NULL) AND (photo_bytes IS NOT NULL) AND (photo_bytes >= 0))))",
      "auth_attempts.chk_auth_attempts_kind CHECK ((kind = ANY (ARRAY['create_account'::text, 'restore'::text])))",
      "options.chk_options_status CHECK ((status = ANY (ARRAY['pending'::text, 'completed'::text])))",
      "suggestions.chk_suggestions_season CHECK ((((season_from IS NULL) AND (season_to IS NULL)) OR ((season_from IS NOT NULL) AND (season_to IS NOT NULL) AND ((season_from >= 1) AND (season_from <= 12)) AND ((season_to >= 1) AND (season_to <= 12)))))",
      "suggestions.chk_suggestions_size CHECK ((size = ANY (ARRAY['hour'::text, 'half_day'::text, 'day'::text, 'overnight'::text])))",
    ]);
  });

  // 認証の関数（data.md §4）。持ち主は ol_definer で、SECURITY DEFINER
  it("has the auth functions owned by ol_definer", async () => {
    const { functions } = await snapshot.take();
    expect(functions).toEqual([
      "auth_create_user(p_session_hash bytea, p_ip_hash bytea) RETURNS TABLE(status text, user_id bigint, retry_after_seconds integer) OWNER ol_definer SECURITY DEFINER",
      "auth_find_user(p_session_hash bytea) RETURNS TABLE(user_id bigint, last_seen_at timestamp with time zone) OWNER ol_definer SECURITY DEFINER",
      "auth_restore(p_code_hash bytea, p_new_session_hash bytea, p_ip_hash bytea, p_current_user_id bigint, p_replace boolean) RETURNS TABLE(status text, user_id bigint, retry_after_seconds integer, local_item_count integer) OWNER ol_definer SECURITY DEFINER",
    ]);
  });

  // 集計のビュー（data.md §4、metrics.md §6）。持ち主は ol_definer で、読めるのは ol_metrics だけ
  it("has the usage views owned by ol_definer and readable only by ol_metrics", async () => {
    const { views, privileges } = await snapshot.take();
    const names = ["usage_client_error_messages", "usage_periods", "usage_retention", "usage_stale_pending"];
    expect(views).toEqual(names.map((name) => `${name} OWNER ol_definer`));
    expect(privileges.filter((p) => p.startsWith("usage_"))).toEqual(names.map((name) => `${name} ol_metrics: SELECT`));
    expect(privileges).toContain("events ol_definer: SELECT");
  });

  // 絵文字を入れるため UTF8（data.md §1）
  it("uses UTF8 for the database", async () => {
    const rows = await sql.rows<{ encoding: string }>(
      "SELECT pg_encoding_to_char(encoding) AS encoding FROM pg_database WHERE datname = current_database()",
    );
    expect(rows).toEqual([{ encoding: "UTF8" }]);
  });

  // 季節は両方 NULL（通年）か、両方 1〜12（data.md §2）。23514 は CHECK 違反の SQLSTATE
  it.each([
    [1, null],
    [null, 12],
    [0, 3],
    [12, 13],
  ])("rejects the season %s - %s", async (from, to) => {
    const insert = sql.rows(
      "INSERT INTO suggestions (theme_id, title, hook, trivia, first_step, size, season_from, season_to) VALUES (1, 't', 'h', 'x', 'f', 'hour', $1, $2)",
      [from, to],
    );
    await expect(insert).rejects.toMatchObject({ code: "23514" });
  });

  it.each([
    [
      "options",
      `WITH u AS (INSERT INTO users (session_hash, created_at, last_seen_at) VALUES ('\\x01', now(), now()) RETURNING id)
       INSERT INTO options (user_id, title, status, sort_order, created_at, updated_at) SELECT id, 't', 'done', 0, now(), now() FROM u`,
    ],
    ["suggestions", "INSERT INTO suggestions (theme_id, title, hook, trivia, first_step, size) VALUES (1, 't', 'h', 'x', 'f', 'week')"],
    ["auth_attempts", "INSERT INTO auth_attempts (kind, ip_hash, occurred_at) VALUES ('login', '\\x01', now())"],
  ])("rejects an unknown value in the text column of %s", async (_table, statement) => {
    await expect(sql.rows(statement)).rejects.toMatchObject({ code: "23514" });
  });

  // ID を書いて入れたマスターデータのあとでも、ID を書かずに足せる（identity の次の値を合わせてある）
  it("continues the identity after the master data", async () => {
    const rows = await sql.rows<{ id: string }>("INSERT INTO tags (name) VALUES ('新しいタグ') RETURNING id");
    expect(rows).toEqual([{ id: "40" }]);
    await sql.rows("DELETE FROM tags WHERE name = '新しいタグ'");
  });
});

describe("master data after all migrations", () => {
  // MySQL 時代の最後の状態と、ID・中身まで一致する（docs/decisions/0044・0047）
  it("matches the master data of the last MySQL migration", async () => {
    const fixture: unknown = JSON.parse(readFileSync(FIXTURE, "utf8"));
    const master = {
      themes: await sql.rows("SELECT id::int, name, sort_order FROM themes ORDER BY id"),
      tags: await sql.rows("SELECT id::int, name FROM tags ORDER BY id"),
      suggestions: await sql.rows(
        "SELECT id::int, theme_id::int, title, hook, trivia, first_step, size, season_from, season_to FROM suggestions ORDER BY id",
      ),
      suggestion_tags: await sql.rows("SELECT suggestion_id::int, tag_id::int FROM suggestion_tags ORDER BY suggestion_id, tag_id"),
    };
    expect(master).toEqual(fixture);
  });

  // 件数は 100 件前後、テーマは 8〜10 個 ※仮決め（data.md §2）
  it("has about 100 suggestions in 8 to 10 themes, and every theme is used", async () => {
    const rows = await sql.rows<{ n: number }>(
      "SELECT COUNT(s.id)::int AS n FROM themes t LEFT JOIN suggestions s ON s.theme_id = t.id GROUP BY t.id",
    );
    const counts = rows.map((r) => r.n);
    expect(counts.length).toBeGreaterThanOrEqual(8);
    expect(counts.length).toBeLessThanOrEqual(10);
    expect(Math.min(...counts)).toBeGreaterThan(0);
    const total = counts.reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThanOrEqual(80);
    expect(total).toBeLessThanOrEqual(120);
  });

  it("gives every suggestion 2 to 4 tags", async () => {
    const rows = await sql.rows(
      `SELECT s.id FROM suggestions s LEFT JOIN suggestion_tags st ON st.suggestion_id = s.id
        GROUP BY s.id HAVING COUNT(st.tag_id) < 2 OR COUNT(st.tag_id) > 4`,
    );
    expect(rows).toEqual([]);
  });

  // 関連がつながるよう、1 つのタグは 3 件以上の提案に付ける（data.md §2）
  it("puts every tag on 3 or more suggestions", async () => {
    const rows = await sql.rows(
      "SELECT t.name FROM tags t LEFT JOIN suggestion_tags st ON st.tag_id = t.id GROUP BY t.id HAVING COUNT(st.suggestion_id) < 3",
    );
    expect(rows).toEqual([]);
  });

  // 今月のおすすめ（screens.md §5）がどの月にも 5 件以上ある。季節は年をまたいでよい（12 → 2）
  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])("has 5 or more seasonal suggestions in month %i", async (month) => {
    const rows = await sql.rows<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM suggestions WHERE season_from IS NOT NULL AND (
         (season_from <= season_to AND $1 BETWEEN season_from AND season_to)
         OR (season_from > season_to AND ($1 >= season_from OR $1 <= season_to)))`,
      [month],
    );
    const [row] = rows;
    expect(row?.n).toBeGreaterThanOrEqual(5);
  });
});

// 手元の DB にすでにある写真の行は、大きさがわからないので 0 で埋める（docs/decisions/0051）
describe("photo_bytes migration on existing rows", () => {
  const target = files.find((f) => f.endsWith("_photo_bytes.sql"));
  if (target === undefined) throw new Error("photo_bytes のマイグレーションが見つからない");
  const dir = mkdtempSync(join(tmpdir(), "optionlist-photo-bytes-"));
  const partial = new DbmateCli(url.toString(), dir);

  beforeAll(async () => {
    await all.drop();
    for (const f of files.filter((f) => f < target)) copyFileSync(join(MIGRATIONS_DIR, f), join(dir, f));
    await partial.up();
    await sql.rows(
      `WITH u AS (INSERT INTO users (session_hash, created_at, last_seen_at) VALUES ('\\x02', now(), now()) RETURNING id),
            o AS (INSERT INTO options (user_id, title, sort_order, created_at, updated_at) SELECT id, 't', 0, now(), now() FROM u RETURNING id, user_id)
       INSERT INTO achievements (option_id, user_id, achieved_at, photo_filename)
       SELECT id, user_id, now(), 'old.jpg' FROM o UNION ALL SELECT id, user_id, now(), NULL FROM o`,
    );
    copyFileSync(join(MIGRATIONS_DIR, target), join(dir, target));
    await partial.up();
  }, HOOK_TIMEOUT_MS);

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("sets 0 for rows with a photo and leaves rows without a photo NULL", async () => {
    const rows = await sql.rows("SELECT photo_filename, photo_bytes FROM achievements ORDER BY photo_filename NULLS LAST");
    expect(rows).toEqual([
      { photo_filename: "old.jpg", photo_bytes: 0 },
      { photo_filename: null, photo_bytes: null },
    ]);
  });
});
