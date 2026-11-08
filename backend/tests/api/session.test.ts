import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { SuggestionCatalog } from "../../../shared/types";
import { PgDatabase } from "../../src/infra/PgDatabase";
import { PgPoolFactory } from "../../src/infra/PgPoolFactory";
import { PromMetrics } from "../../src/metrics/PromMetrics";
import { FixedClock } from "../fakes/FakeOptionStore";
import { OptionsApiClient, SessionAgent } from "../fakes/OptionsApiClient";
import { TestApp } from "../fakes/TestApp";
import { TestDatabase } from "../fakes/TestDatabase";
import { TestUsers } from "../fakes/TestUsers";

// アカウントとセッション（api.md §6、testing.md §2）
const pool = new PgPoolFactory(process.env, console, "DATABASE_URL").create();
const appPool = new PgPoolFactory(process.env, console, "APP_DATABASE_URL").create();
const data = new TestDatabase(pool);
const users = new TestUsers(pool);
const db = new PgDatabase(appPool, new PromMetrics());
const app = new TestApp({ db }).build();
const SET_COOKIE = /^ol_session=[A-Za-z0-9_-]{43}; Max-Age=34560000; Path=\/; Expires=[^;]+; HttpOnly; SameSite=Lax$/;
const PENDING = "/api/options?status=pending";
const USER_COUNT = "SELECT COUNT(*) AS n FROM users";

beforeEach(async () => {
  await data.reset();
});

afterAll(async () => {
  await data.reset();
  await Promise.all([pool.end(), appPool.end()]);
});

describe("a request without a cookie", () => {
  it("reads empty lists and creates no account", async () => {
    const anonymous = new SessionAgent(app);
    const list = await anonymous.send((r) => r.get(PENDING));
    expect([list.status, list.body, list.setCookie]).toEqual([200, [], null]);
    const { body } = await anonymous.send((r) => r.get("/api/suggestions"));
    const { suggestions } = body as SuggestionCatalog;
    expect(suggestions.every((s) => s.optionStatus === null)).toBe(true);
    const event = { type: "client_error", payload: { message: "x" }, occurredAt: new Date().toISOString() };
    const events = await anonymous.send((r) => r.post("/api/events").send({ events: [event] }));
    expect(events.status).toBe(202);
    const { rows } = await pool.query(USER_COUNT);
    expect(rows).toEqual([{ n: 0 }]);
  });

  // ほかの書き込みは自分の行を指すので、アカウントがなければ 404（api.md §6）
  it("answers 404 to the other writes and creates no account", async () => {
    const anonymous = new SessionAgent(app);
    const patched = await anonymous.send((r) => r.patch("/api/options/1").send({ title: "x" }));
    const achieved = await anonymous.send((r) => r.post("/api/options/1/achievements"));
    expect([patched.status, achieved.status]).toEqual([404, 404]);
    const { rows } = await pool.query(USER_COUNT);
    expect(rows).toEqual([{ n: 0 }]);
  });

  it("creates the account on the first POST /api/options and sets the session cookie", async () => {
    const agent = new SessionAgent(app);
    const { status, setCookie } = await agent.send((r) => r.post("/api/options").send({ title: "a" }));
    expect(status).toBe(201);
    expect(setCookie).toMatch(SET_COOKIE);
    const { rows } = await pool.query("SELECT u.id, o.title FROM users u JOIN options o ON o.user_id = u.id");
    expect(rows).toEqual([{ id: 1, title: "a" }]);
    const { body } = await agent.send((r) => r.get(PENDING));
    expect(body).toEqual([expect.objectContaining({ title: "a" })]);
  });

  // 入力が違えば、アカウントを作らない
  it("does not create an account for an invalid option", async () => {
    const { status } = await new SessionAgent(app).send((r) => r.post("/api/options").send({ title: " " }));
    expect(status).toBe(400);
    const { rows } = await pool.query(USER_COUNT);
    expect(rows).toEqual([{ n: 0 }]);
  });
});

describe("a request with a cookie", () => {
  it("keeps using the same account and does not create another", async () => {
    const api = new OptionsApiClient(app);
    await api.added("a");
    await api.added("b");
    expect(await api.titles("?status=pending")).toEqual(["b", "a"]);
    const { rows } = await pool.query(USER_COUNT);
    expect(rows).toEqual([{ n: 1 }]);
  });

  it.each(["ol_session=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "ol_session=short", "other=1"])(
    "treats the cookie %s as no account",
    async (cookie) => {
      await users.create();
      const { status, body } = await new SessionAgent(app, cookie).send((r) => r.get(PENDING));
      expect([status, body]).toEqual([200, []]);
    },
  );

  // last_seen_at は日本時間の日付が変わってから最初のリクエストで 1 回だけ書き、Cookie の期限を延ばす（api.md §6）
  it("writes last_seen_at once a day in Japan time and sets the cookie again", async () => {
    const clock = new FixedClock("2026-11-10T00:00:00.000Z");
    const clocked = new TestApp({ db, clock }).build();
    // 11/09 23:59:59（日本時間）に最後に使った人と、11/10 00:00:00（日本時間）に使った人
    const yesterday = await users.create(new Date("2026-11-09T14:59:59.000Z"));
    const today = await users.create(new Date("2026-11-09T15:00:00.000Z"));
    const lastSeen = async (id: number): Promise<string> => {
      const { rows } = await pool.query<{ at: string }>("SELECT to_char(last_seen_at, 'YYYY-MM-DD\"T\"HH24:MI:SS') AS at FROM users WHERE id = $1", [id]);
      const [row] = rows;
      return row === undefined ? "" : row.at;
    };

    const first = await new SessionAgent(clocked, yesterday.cookie).send((r) => r.get(PENDING));
    expect(first.setCookie).toMatch(SET_COOKIE);
    expect(first.setCookie).toContain(`${yesterday.cookie};`);
    expect(await lastSeen(yesterday.id)).toBe("2026-11-10T00:00:00");

    clock.advance(60_000);
    const second = await new SessionAgent(clocked, yesterday.cookie).send((r) => r.get(PENDING));
    expect(second.setCookie).toBeNull();
    expect(await lastSeen(yesterday.id)).toBe("2026-11-10T00:00:00");

    const same = await new SessionAgent(clocked, today.cookie).send((r) => r.get(PENDING));
    expect(same.setCookie).toBeNull();
    expect(await lastSeen(today.id)).toBe("2026-11-09T15:00:00");
  });
});

describe("the limit on creating accounts", () => {
  // 1 つの IP から 1 時間に 20 件まで（api.md §6 ※仮決め）。supertest はどれも同じ IP から送る
  it("answers 429 with Retry-After after 20 accounts from one IP in an hour", async () => {
    for (let i = 0; i < 20; i++) {
      const { status } = await new SessionAgent(app).send((r) => r.post("/api/options").send({ title: `t${i}` }));
      expect(status).toBe(201);
    }
    const { status, body, headers, setCookie } = await new SessionAgent(app).send((r) => r.post("/api/options").send({ title: "over" }));
    expect([status, body, setCookie]).toMatchObject([429, { error: { code: "TOO_MANY_REQUESTS" } }, null]);
    expect(Number(headers["retry-after"])).toBeGreaterThan(0);
    const { rows } = await pool.query("SELECT COUNT(*) AS n FROM options");
    expect(rows).toEqual([{ n: 20 }]);
    // アカウントがある人の追加は止めない
    const { cookie } = await users.create();
    const mine = await new SessionAgent(app, cookie).send((r) => r.post("/api/options").send({ title: "mine" }));
    expect(mine.status).toBe(201);
  });
});
