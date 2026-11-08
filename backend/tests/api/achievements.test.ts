import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PgDatabase } from "../../src/infra/PgDatabase";
import { PgPoolFactory } from "../../src/infra/PgPoolFactory";
import { PromMetrics } from "../../src/metrics/PromMetrics";
import { OptionsApiClient } from "../fakes/OptionsApiClient";
import { TestApp } from "../fakes/TestApp";
import { TestDatabase } from "../fakes/TestDatabase";

// POST /api/options/:id/achievements（api.md §2、testing.md §2）
// 後始末は ol_migrator（pool）、アプリは ol_app（appPool。testing.md §0）
const pool = new PgPoolFactory(process.env, console, "DATABASE_URL").create();
const appPool = new PgPoolFactory(process.env, console, "APP_DATABASE_URL").create();
const data = new TestDatabase(pool);
const app = new TestApp({ db: new PgDatabase(appPool, new PromMetrics()) }).build();
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
// 各テストで新しい人（最初の追加でアカウントができる）
const api = new OptionsApiClient(app);

beforeEach(async () => {
  await data.reset();
  api.use(null);
});

afterAll(async () => {
  await data.reset();
  await Promise.all([pool.end(), appPool.end()]);
});

describe("POST /api/options/:id/achievements", () => {
  it("records an achievement and counts it on the option", async () => {
    const { id } = await api.added("a");
    const { status, body } = await api.achieve(id);
    expect(status).toBe(201);
    expect(body).toEqual({ id: expect.any(Number), optionId: id, achievedAt: expect.stringMatching(ISO), photoUrl: null });
    await api.achieve(id);

    const detail = await api.detail(id);
    expect(detail.body).toMatchObject({ achievementCount: 2, status: "pending" });
    expect(detail.body).toMatchObject({ achievements: [body, { optionId: id }] });
  });

  // 🎉 は completed の項目にも押せる（screens.md §4）。status は変えない
  it("records an achievement for a completed option without changing its status", async () => {
    const { id } = await api.added("a");
    await api.patch(id, { status: "completed" });
    expect(await api.achieve(id)).toMatchObject({ status: 201 });
    expect(await api.detail(id)).toMatchObject({ body:{ status: "completed", achievementCount: 1 } });
  });

  it.each(["999", "abc", "0"])("returns 404 for the option %s", async (id) => {
    expect(await api.achieve(id)).toMatchObject({ status: 404, body: { error: { code: "NOT_FOUND" } } });
    const { rows } = await pool.query("SELECT COUNT(*) AS n FROM achievements");
    expect(rows).toEqual([{ n: 0 }]);
  });
});
