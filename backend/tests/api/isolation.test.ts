import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Achievement, Option, SuggestionCatalog, SuggestionDetail } from "../../../shared/types";
import { PgDatabase } from "../../src/infra/PgDatabase";
import { PgPoolFactory } from "../../src/infra/PgPoolFactory";
import { PromMetrics } from "../../src/metrics/PromMetrics";
import { LocalPhotoFiles } from "../../src/repositories/LocalPhotoFiles";
import { OptionsApiClient, SessionAgent } from "../fakes/OptionsApiClient";
import { RouteRecorder } from "../fakes/RouteRecorder";
import { TestApp } from "../fakes/TestApp";
import { TestDatabase } from "../fakes/TestDatabase";
import { TestUsers } from "../fakes/TestUsers";


// 他人のデータが見えないこと（testing.md §7 の 3。docs/decisions/0046）。失敗の数が metrics.md §2 の指標になる
// 新しいルートを足したら、CASES に 1 行足す（足さないと「has a case」が落ちる）
type Target = "option" | "achievement" | "photo";
type Case =
  // :id（写真は :filename）に A の行を指定すると 404
  | { kind: "others-row"; target: Target; body?: object; photo?: true }
  // 一覧に A の行が出ない（GET /api/options・提案の optionStatus・optionId）
  | { kind: "list" }
  // A の id を混ぜると 400（PUT /api/options/order）
  | { kind: "order" }
  // A が追加した提案を B も追加できる（UNIQUE は人ごと）
  | { kind: "create" }
  | { kind: "no-user-data"; reason: string };

const CASES: Record<string, Case> = {
  "GET /api/health": { kind: "no-user-data", reason: "DB を読まない" },
  "GET /api/health/db": { kind: "no-user-data", reason: "SELECT 1 だけ" },
  "GET /api/metrics": { kind: "no-user-data", reason: "件数と時間の集計だけで、利用者の行を返さない" },
  "POST /api/events": { kind: "no-user-data", reason: "書くだけで、誰の行も指定しない・返さない（user_id を持たない）" },
  "GET /api/options": { kind: "list" },
  "POST /api/options": { kind: "create" },
  "PUT /api/options/order": { kind: "order" },
  "GET /api/options/:id": { kind: "others-row", target: "option" },
  "PATCH /api/options/:id": { kind: "others-row", target: "option", body: { title: "B が書き換えた" } },
  "DELETE /api/options/:id": { kind: "others-row", target: "option" },
  "POST /api/options/:id/achievements": { kind: "others-row", target: "option" },
  "PUT /api/achievements/:id/photo": { kind: "others-row", target: "achievement", photo: true },
  "DELETE /api/achievements/:id/photo": { kind: "others-row", target: "achievement" },
  "GET /api/photos/:filename": { kind: "others-row", target: "photo" },
  "GET /api/suggestions": { kind: "list" },
  "GET /api/suggestions/:id": { kind: "list" },
};

const recorder = new RouteRecorder();
new TestApp().routes(recorder);
const registered = recorder.routes();
const othersRowRoutes = registered.filter((route) => {
  const found = CASES[route];
  return found !== undefined && found.kind === "others-row";
});

const pool = new PgPoolFactory(process.env, console, "DATABASE_URL").create();
const appPool = new PgPoolFactory(process.env, console, "APP_DATABASE_URL").create();
const data = new TestDatabase(pool);
const users = new TestUsers(pool);
const uploadDir = mkdtempSync(join(tmpdir(), "optionlist-isolation-"));
const app = new TestApp({ db: new PgDatabase(appPool, new PromMetrics()), photoFiles: new LocalPhotoFiles(uploadDir) }).build();
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100)]);
// A が提案から追加する提案
const SUGGESTION = 1;

// A・B（beforeAll で作る）
const cookies: Record<"a" | "b", string> = { a: "", b: "" };
const aUser = { id: 0 };
// A の行（:id・:filename に入れる値）
const aRows: Record<Target, string> = { option: "", achievement: "", photo: "" };

beforeAll(async () => {
  await data.reset();
  const a = await users.create();
  const b = await users.create();
  cookies.a = a.cookie;
  cookies.b = b.cookie;
  aUser.id = a.id;
  const aApi = new OptionsApiClient(app, a.cookie);
  const option = await aApi.added("A の項目");
  await aApi.added("A が提案から追加", SUGGESTION);
  const { body } = await aApi.achieve(option.id);
  const achievement = body as Achievement;
  const uploaded = await aApi.upload(`/api/achievements/${achievement.id}/photo`, JPEG, "a.jpg");
  const { photoUrl } = uploaded.body as Achievement;
  aRows.option = String(option.id);
  aRows.achievement = String(achievement.id);
  aRows.photo = String(photoUrl).replace("/api/photos/", "");
  await new OptionsApiClient(app, cookies.b).added("B の項目");
});

afterAll(async () => {
  await data.reset();
  rmSync(uploadDir, { recursive: true, force: true });
  await Promise.all([pool.end(), appPool.end()]);
});

describe("the case table", () => {
  it("collects the registered routes", () => {
    expect(registered.length).toBeGreaterThan(10);
  });

  it.each(registered)("%s has a case", (route) => {
    expect(CASES[route]).toBeDefined();
  });
});

describe("another person's rows", () => {
  // A の行を JSON にして、前後で比べる（ol_migrator で全員の行を読む）
  const snapshot = async (): Promise<unknown> => {
    const { rows } = await pool.query(
      `SELECT o.*, (SELECT json_agg(x ORDER BY x.id) FROM achievements x WHERE x.option_id = o.id) AS achievements
         FROM options o WHERE o.user_id = $1 ORDER BY o.id`,
      [aUser.id],
    );
    return rows;
  };

  it.each(othersRowRoutes.flatMap((route) => [[route, "B"], [route, "no cookie"]]))("%s answers 404 to %s for A's row", async (route, who) => {
    const found = CASES[route];
    if (found?.kind !== "others-row") throw new Error(`${route} のケースがない`);
    const [method = "", template = ""] = route.split(" ");
    const path = template.replace(/:id|:filename/, aRows[found.target]);
    const before = await snapshot();
    const res = await new SessionAgent(app, who === "B" ? cookies.b : null).send((r) => {
      const pending = method === "GET" ? r.get(path) : method === "POST" ? r.post(path) : method === "PATCH" ? r.patch(path) : method === "PUT" ? r.put(path) : r.delete(path);
      if (found.photo === true) return pending.attach("photo", JPEG, "b.jpg");
      return found.body === undefined ? pending : pending.send(found.body);
    });
    expect([res.status, res.body]).toMatchObject([404, { error: { code: "NOT_FOUND" } }]);
    expect(await snapshot()).toEqual(before);
    expect(existsSync(join(uploadDir, aRows.photo))).toBe(true);
  });

  it.each([["B"], ["no cookie"]])("hides A's options and the suggestion state from %s", async (who) => {
    const agent = new SessionAgent(app, who === "B" ? cookies.b : null);
    const ids: number[] = [];
    for (const status of ["pending", "completed"]) {
      const { body } = await agent.send((r) => r.get(`/api/options?status=${status}`));
      ids.push(...(body as Option[]).map((o) => o.id));
    }
    const { rows } = await pool.query<{ id: number }>("SELECT id FROM options WHERE user_id = $1", [aUser.id]);
    expect(ids.filter((id) => rows.some((row) => row.id === id))).toEqual([]);
    // アカウントがない人には、だれの項目も出ない（testing.md §7 の 3）
    if (who === "no cookie") expect(ids).toEqual([]);
    const { body: catalog } = await agent.send((r) => r.get("/api/suggestions"));
    const { suggestions } = catalog as SuggestionCatalog;
    expect(suggestions.find((s) => s.id === SUGGESTION)).toMatchObject({ optionStatus: null });
    const { body: detail } = await agent.send((r) => r.get(`/api/suggestions/${SUGGESTION}`));
    expect(detail as SuggestionDetail).toMatchObject({ optionStatus: null, optionId: null });
  });

  it("rejects A's id in PUT /api/options/order and keeps A's order", async () => {
    const before = await snapshot();
    const bApi = new OptionsApiClient(app, cookies.b);
    const { body } = await bApi.list("?status=pending");
    const own = (body as Option[]).map((o) => o.id);
    const { status } = await bApi.reorder({ ids: [Number(aRows.option), ...own] });
    expect(status).toBe(400);
    expect(await snapshot()).toEqual(before);
  });

  it("lets B add the suggestion that A has added", async () => {
    const { status } = await new OptionsApiClient(app, cookies.b).create({ title: "B も提案から追加", suggestionId: SUGGESTION });
    expect(status).toBe(201);
  });
});
