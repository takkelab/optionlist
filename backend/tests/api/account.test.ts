import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { AccountStatus } from "../../../shared/types";
import { PgDatabase } from "../../src/infra/PgDatabase";
import { PgPoolFactory } from "../../src/infra/PgPoolFactory";
import { PromMetrics } from "../../src/metrics/PromMetrics";
import { LocalPhotoFiles } from "../../src/repositories/LocalPhotoFiles";
import { AccountApiClient } from "../fakes/AccountApiClient";
import { OptionsApiClient, SessionAgent } from "../fakes/OptionsApiClient";
import { TestApp } from "../fakes/TestApp";
import { TestDatabase } from "../fakes/TestDatabase";
import { TestUsers } from "../fakes/TestUsers";

// アカウント・復旧コード・回数の制限・すべてのデータを消す（api.md §2・§6、testing.md §2）
const pool = new PgPoolFactory(process.env, console, "DATABASE_URL").create();
const appPool = new PgPoolFactory(process.env, console, "APP_DATABASE_URL").create();
const data = new TestDatabase(pool);
const users = new TestUsers(pool);
const uploadDir = mkdtempSync(join(tmpdir(), "optionlist-account-"));
const app = new TestApp({ db: new PgDatabase(appPool, new PromMetrics()), photoFiles: new LocalPhotoFiles(uploadDir) }).build();
const api = new AccountApiClient(app, pool);
const CODE_SHAPE = /^[2-9A-HJKMNP-Z]{4}(-[2-9A-HJKMNP-Z]{4}){3}$/;

beforeEach(async () => {
  await data.reset();
});

afterAll(async () => {
  await data.reset();
  rmSync(uploadDir, { recursive: true, force: true });
  await Promise.all([pool.end(), appPool.end()]);
});

describe("GET /api/account", () => {
  it("answers no account without a cookie and creates none", async () => {
    const { status, body, setCookie } = await new SessionAgent(app).send((r) => r.get("/api/account"));
    expect([status, body, setCookie]).toEqual([200, { hasAccount: false, hasRecoveryCode: false, createdAt: null }, null]);
    expect(await api.counts()).toEqual([0, 0, 0]);
  });

  it("answers the account and whether a recovery code is issued", async () => {
    const { cookie } = await users.create();
    const agent = new SessionAgent(app, cookie);
    const { body } = await agent.send((r) => r.get("/api/account"));
    const { createdAt } = body as AccountStatus;
    expect(body).toMatchObject({ hasAccount: true, hasRecoveryCode: false });
    expect(Number.isNaN(Date.parse(String(createdAt)))).toBe(false);
    await api.issue(agent);
    const after = await agent.send((r) => r.get("/api/account"));
    expect(after.body).toMatchObject({ hasAccount: true, hasRecoveryCode: true });
  });
});

describe("POST /api/account/recovery-code", () => {
  it("answers 404 without an account", async () => {
    const { status, body } = await new SessionAgent(app).send((r) => r.post("/api/account/recovery-code"));
    expect([status, body]).toMatchObject([404, { error: { code: "NOT_FOUND" } }]);
  });

  it("returns a code of 16 characters in groups of 4 and stores only its hash", async () => {
    const { cookie, id } = await users.create();
    const code = await api.issue(new SessionAgent(app, cookie));
    expect(code).toMatch(CODE_SHAPE);
    const { rows } = await pool.query("SELECT octet_length(recovery_code_hash) AS n FROM users WHERE id = $1", [id]);
    expect(rows).toEqual([{ n: 32 }]);
  });
});

describe("POST /api/account/restore", () => {
  it("moves another device to the account, and the old cookie sees nothing", async () => {
    const { agent: aAgent, photo: aPhoto } = await api.withPhoto("A の項目");
    const oldCookie = aAgent.cookie();
    const code = await api.issue(aAgent);
    const b = new SessionAgent(app);
    const { status, body, setCookie } = await api.restore(b, { code });
    expect([status, body]).toMatchObject([200, { hasAccount: true, hasRecoveryCode: false }]);
    expect(setCookie).toMatch(/^ol_session=[A-Za-z0-9_-]{43};/);
    expect(await api.titles(b)).toEqual(["A の項目"]);
    expect(await api.titles(new SessionAgent(app, oldCookie))).toEqual([]);
    expect(existsSync(join(uploadDir, aPhoto))).toBe(true);
  });

  it("answers 404 to a used code and to a code issued before the latest one", async () => {
    const { cookie } = await users.create();
    const agent = new SessionAgent(app, cookie);
    const replaced = await api.issue(agent);
    const latest = await api.issue(agent);
    expect(await api.restoreStatus(new SessionAgent(app), { code: replaced })).toBe(404);
    expect(await api.restoreStatus(new SessionAgent(app), { code: latest })).toBe(200);
    const used = await api.restore(new SessionAgent(app), { code: latest });
    expect([used.status, used.body]).toMatchObject([404, { error: { code: "NOT_FOUND" } }]);
  });

  it("accepts spaces, hyphens and lower case", async () => {
    const { cookie } = await users.create();
    const code = await api.issue(new SessionAgent(app, cookie));
    const messy = ` ${code.toLowerCase().replaceAll("-", " ")} `;
    expect(await api.restoreStatus(new SessionAgent(app), { code: messy })).toBe(200);
  });

  it.each([[{}], [{ code: 12 }], [{ code: "ABCD" }], [{ code: "x".repeat(65) }], [{ code: "ABCD-EFGH-JKMN-PQRS", replace: "yes" }]])(
    "answers 400 to %j",
    async (body) => {
      const { status, body: answer } = await api.restore(new SessionAgent(app), body);
      expect([status, answer]).toMatchObject([400, { error: { code: "VALIDATION_ERROR" } }]);
    },
  );

  // この端末に別のアカウントの項目があれば、replace なしでは 409 と件数を返し、コードを使わない（api.md §6）
  it("asks to confirm, then replaces the other account on this device and removes its rows and photos", async () => {
    const { agent: aAgent, photo: aPhoto } = await api.withPhoto("A の項目");
    const code = await api.issue(aAgent);
    const { agent: bAgent, photo: bPhoto } = await api.withPhoto("B の項目");
    await new OptionsApiClient(app, bAgent.cookie()).added("B の 2 件目");
    const asked = await api.restore(bAgent, { code });
    expect([asked.status, asked.body, asked.setCookie]).toMatchObject([409, { error: { code: "CONFLICT" }, localItemCount: 2 }, null]);
    expect(await api.titles(bAgent)).toEqual(["B の 2 件目", "B の項目"]);
    const replaced = await api.restore(bAgent, { code, replace: true });
    expect(replaced.status).toBe(200);
    expect(await api.titles(bAgent)).toEqual(["A の項目"]);
    expect(await api.counts()).toEqual([1, 1, 1]);
    expect([existsSync(join(uploadDir, aPhoto)), existsSync(join(uploadDir, bPhoto))]).toEqual([true, false]);
  });

  // 自分のコードを自分の端末で入れても、何も消えず 409 にもならない。Cookie だけが新しい鍵になる
  it("keeps everything when the code is of the account on this device, and only renews the cookie", async () => {
    const { agent: aAgent, photo: aPhoto } = await api.withPhoto("A の項目");
    const oldCookie = aAgent.cookie();
    const code = await api.issue(aAgent);
    const { status } = await api.restore(aAgent, { code });
    expect(status).toBe(200);
    expect(aAgent.cookie()).not.toBe(oldCookie);
    expect(await api.titles(aAgent)).toEqual(["A の項目"]);
    expect(await api.titles(new SessionAgent(app, oldCookie))).toEqual([]);
    expect([await api.counts(), existsSync(join(uploadDir, aPhoto))]).toEqual([[1, 1, 1], true]);
  });

  // 1 つの IP から 1 時間に 10 回まで（api.md §6 ※仮決め）。supertest はどれも同じ IP から送る
  it("answers 429 with Retry-After after 10 attempts, also for the right code, without using it", async () => {
    const { cookie, id } = await users.create();
    const code = await api.issue(new SessionAgent(app, cookie));
    for (let i = 0; i < 10; i++) expect(await api.restoreStatus(new SessionAgent(app), { code: "2222-2222-2222-2222" })).toBe(404);
    const { status, body, headers, setCookie } = await api.restore(new SessionAgent(app), { code });
    expect([status, body, setCookie]).toMatchObject([429, { error: { code: "TOO_MANY_REQUESTS" } }, null]);
    expect(Number(headers["retry-after"])).toBeGreaterThan(0);
    const { rows } = await pool.query("SELECT recovery_code_hash IS NOT NULL AS kept FROM users WHERE id = $1", [id]);
    expect(rows).toEqual([{ kept: true }]);
  });
});

describe("DELETE /api/account", () => {
  it("removes the rows and the photo files, and clears the cookie", async () => {
    const { agent: aAgent, photo: aPhoto } = await api.withPhoto("A の項目");
    const { status, setCookie } = await aAgent.send((r) => r.delete("/api/account"));
    expect(status).toBe(204);
    expect(setCookie).toMatch(/^ol_session=; Max-Age=0; Path=\/; Expires=[^;]+; HttpOnly; SameSite=Lax$/);
    expect(await api.counts()).toEqual([0, 0, 0]);
    expect(existsSync(join(uploadDir, aPhoto))).toBe(false);
    expect(await api.titles(aAgent)).toEqual([]);
  });

  it("answers 204 without an account", async () => {
    const { status } = await new SessionAgent(app).send((r) => r.delete("/api/account"));
    expect(status).toBe(204);
  });

  it("leaves the other people's rows", async () => {
    const { cookie } = await users.create();
    await new OptionsApiClient(app, cookie).added("ほかの人の項目");
    const { agent: aAgent } = await api.withPhoto("A の項目");
    await aAgent.send((r) => r.delete("/api/account"));
    expect(await api.titles(new SessionAgent(app, cookie))).toEqual(["ほかの人の項目"]);
  });
});
