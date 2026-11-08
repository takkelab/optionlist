import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { SuggestionSummary } from "../../../shared/types";
import { PgDatabase } from "../../src/infra/PgDatabase";
import { PgPoolFactory } from "../../src/infra/PgPoolFactory";
import { PromMetrics } from "../../src/metrics/PromMetrics";
import { CountingDatabase } from "../fakes/CountingDatabase";
import { OptionsApiClient } from "../fakes/OptionsApiClient";
import { SuggestionsApiClient } from "../fakes/SuggestionsApiClient";
import { TestApp } from "../fakes/TestApp";
import { TestDatabase } from "../fakes/TestDatabase";
import { TestUsers } from "../fakes/TestUsers";

// GET /api/suggestions、GET /api/suggestions/:id（api.md §2、testing.md §2）。提案はマイグレーションで入れたマスターデータを使う
// マスターデータの確かめと後始末は ol_migrator（pool）、アプリは ol_app（appPool。testing.md §0）
const pool = new PgPoolFactory(process.env, console, "DATABASE_URL").create();
const appPool = new PgPoolFactory(process.env, console, "APP_DATABASE_URL").create();
const data = new TestDatabase(pool);
const users = new TestUsers(pool);
const db = new CountingDatabase(new PgDatabase(appPool, new PromMetrics()));
// セッションの SQL（auth_find_user）は 1 リクエストの本数に数えない（metrics.md §4）ので、数えない DB に分ける
const app = new TestApp({ db, sessionDb: new PgDatabase(appPool, new PromMetrics()) }).build();
const NOT_FOUND = { error: { code: "NOT_FOUND" } };
// 各テストの人。提案の画面と options の API を同じ Cookie で呼ぶ（beforeEach で Cookie を入れる）
const api = new SuggestionsApiClient(app);
const options = new OptionsApiClient(app);

beforeEach(async () => {
  await data.reset();
  const { cookie } = await users.create();
  api.use(cookie);
  options.use(cookie);
});

afterAll(async () => {
  await data.reset();
  await Promise.all([pool.end(), appPool.end()]);
});

describe("GET /api/suggestions", () => {
  it("returns the themes in sort order, the tags and the suggestions in id order", async () => {
    const { rows: themeRows } = await pool.query("SELECT id, name FROM themes ORDER BY sort_order");
    const { rows: tagRows } = await pool.query("SELECT id FROM tags ORDER BY id");
    const { rows: suggestionRows } = await pool.query("SELECT id FROM suggestions ORDER BY id");
    const { themes, tags, suggestions } = await api.catalog();

    expect(themes).toEqual(themeRows);
    expect(tags.map((t) => t.id)).toEqual(tagRows.map((r) => r.id));
    expect(suggestions.map((s) => s.id)).toEqual(suggestionRows.map((r) => r.id));
    expect(suggestions.length).toBeGreaterThan(0);
  });

  it("returns each suggestion as a summary with its tag ids in id order", async () => {
    const { rows } = await pool.query(
      "SELECT id, hook, title, size, season_from, season_to, theme_id FROM suggestions WHERE id = 1",
    );
    const { rows: tagRows } = await pool.query("SELECT tag_id FROM suggestion_tags WHERE suggestion_id = 1 ORDER BY tag_id");
    const { suggestions } = await api.catalog();
    const [row] = rows;

    expect(suggestions[0]).toEqual({
      id: 1,
      hook: row?.hook,
      title: row?.title,
      size: row?.size,
      seasonFrom: row?.season_from,
      seasonTo: row?.season_to,
      themeId: row?.theme_id,
      tagIds: tagRows.map((r) => r.tag_id),
      optionStatus: null,
    });
    for (const { tagIds } of suggestions) expect(tagIds).toEqual(tagIds.toSorted((a, b) => a - b));
  });

  it("marks the suggestion added, done, and back to none after the option is deleted", async () => {
    const status = async (): Promise<SuggestionSummary["optionStatus"] | undefined> => {
      const { suggestions } = await api.catalog();
      const [found] = suggestions.filter((s) => s.id === 3);
      return found?.optionStatus;
    };
    const added = await options.added("天の川を見に行く", 3);
    expect(await status()).toBe("pending");

    await options.patch(added.id, { status: "completed" });
    expect(await status()).toBe("completed");

    await options.remove(added.id);
    expect(await status()).toBeNull();
  });

  it("reads the catalog with at most 3 SQL statements", async () => {
    const before = db.count();
    await api.catalog();
    expect(db.count() - before).toBeLessThanOrEqual(3);
  });
});

describe("GET /api/suggestions/:id", () => {
  it("returns the trivia, the first step and the tags in id order", async () => {
    const { rows } = await pool.query("SELECT trivia, first_step FROM suggestions WHERE id = 1");
    const { rows: tagRows } = await pool.query(
      "SELECT t.id, t.name FROM suggestion_tags st JOIN tags t ON t.id = st.tag_id WHERE st.suggestion_id = 1 ORDER BY t.id",
    );
    const { suggestions } = await api.catalog();
    const detail = await api.found(1);
    const { related: _related, trivia, firstStep, tags, optionId, ...summary } = detail;

    expect(summary).toEqual(suggestions[0]);
    expect(optionId).toBeNull();
    const [row] = rows;
    expect({ trivia, firstStep }).toEqual({ trivia: row?.trivia, firstStep: row?.first_step });
    expect(tags).toEqual(tagRows);
  });

  // 期待値は一覧の tagIds から数え直して作る
  it.each([1, 13, 50, 95])("returns up to 5 related suggestions of %i by the shared tags, then by id, without itself", async (id) => {
    const { suggestions } = await api.catalog();
    const [me] = suggestions.filter((s) => s.id === id);
    const mine = me?.tagIds ?? [];
    const expected = suggestions
      .filter((s) => s.id !== id)
      .map(({ id: other, tagIds }) => ({ id: other, shared: tagIds.filter((t) => mine.includes(t)).length }))
      .filter((s) => s.shared > 0)
      .toSorted((a, b) => b.shared - a.shared || a.id - b.id)
      .slice(0, 5)
      .map((s) => s.id);

    const { related } = await api.found(id);
    expect(expected).toHaveLength(5);
    expect(related.map((s) => s.id)).toEqual(expected);
    // 関連の行は一覧の行と同じ形
    const [first] = related;
    expect(first).toEqual(suggestions.find((s) => s.id === first?.id));
  });

  it("marks the suggestion itself added, done, and back to none after the option is deleted", async () => {
    const added = await options.added("ふたご座流星群を見る", 1);
    expect(await api.found(1)).toMatchObject({ optionStatus: "pending", optionId: added.id });

    await options.patch(added.id, { status: "completed" });
    expect(await api.found(1)).toMatchObject({ optionStatus: "completed", optionId: added.id });

    await options.remove(added.id);
    expect(await api.found(1)).toMatchObject({ optionStatus: null, optionId: null });
  });

  it("marks the related suggestions that were added", async () => {
    const { related: before } = await api.found(1);
    const [first] = before;
    if (first === undefined) throw new Error("関連がない");
    await options.added(first.title, first.id);

    const { related } = await api.found(1);
    expect(related[0]).toMatchObject({ id: first.id, optionStatus: "pending" });
  });

  it("reads one suggestion with at most 3 SQL statements", async () => {
    const before = db.count();
    await api.found(1);
    expect(db.count() - before).toBeLessThanOrEqual(3);
  });

  it.each(["99999", "0", "abc", "4294967296"])("answers 404 for the suggestion %s", async (id) => {
    const { status, body } = await api.detail(id);
    expect(status).toBe(404);
    expect(body).toMatchObject(NOT_FOUND);
  });
});
