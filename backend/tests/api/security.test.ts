import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PgDatabase } from "../../src/infra/PgDatabase";
import { PgPoolFactory } from "../../src/infra/PgPoolFactory";
import { PromMetrics } from "../../src/metrics/PromMetrics";
import { FakeDatabase } from "../fakes/FakeDatabase";
import { FixedClock } from "../fakes/FakeOptionStore";
import { SessionAgent } from "../fakes/OptionsApiClient";
import type { ApiResult } from "../fakes/OptionsApiClient";
import { TestApp } from "../fakes/TestApp";
import { TestDatabase } from "../fakes/TestDatabase";
import { TEST_METRICS_AUTH, TEST_ORIGIN, TestRequests } from "../fakes/TestRequests";
import { TestUsers } from "../fakes/TestUsers";
import { ThrowingController } from "../fakes/ThrowingController";

// API のセキュリティの土台（testing.md §2 のセキュリティ。docs/decisions/0038・0050）
const pool = new PgPoolFactory(process.env, console, "DATABASE_URL").create();
const appPool = new PgPoolFactory(process.env, console, "APP_DATABASE_URL").create();
const data = new TestDatabase(pool);
const users = new TestUsers(pool);
const db = new PgDatabase(appPool, new PromMetrics());
const http = new TestRequests(new TestApp({ db }).build());
const NOW = "2026-11-09T03:00:00.000Z";
const MINUTE_MS = 60 * 1000;
const EVENTS = { events: [{ type: "client_error", payload: { message: "x" }, occurredAt: NOW }] };
const USER_COUNT = "SELECT COUNT(*) AS n FROM users";
const MISSING_ACHIEVEMENT = "/api/options/999/achievements";

beforeEach(async () => {
  await data.reset();
});

afterAll(async () => {
  await data.reset();
  await Promise.all([pool.end(), appPool.end()]);
});

describe("Origin check (CSRF)", () => {
  it.each([
    ["another site", "https://evil.example"],
    ["the literal null origin", "null"],
  ])("answers 403 FORBIDDEN to a write from %s and changes nothing", async (_name, origin) => {
    const res = await http.write("post", "/api/options", { Origin: origin }).send({ title: "a" });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: { code: "FORBIDDEN" } });
    const { rows } = await pool.query(USER_COUNT);
    expect(rows).toEqual([{ n: 0 }]);
  });

  it("answers 403 to a write without Origin and changes nothing", async () => {
    const user = await users.create();
    const res = await http.call("delete", "/api/account", { Cookie: user.cookie });
    expect(res.status).toBe(403);
    const { rows } = await pool.query(USER_COUNT);
    expect(rows).toEqual([{ n: 1 }]);
  });

  it("lets reads through without Origin", async () => {
    const res = await http.call("get", "/api/options?status=pending");
    expect([res.status, res.body]).toEqual([200, []]);
  });

  it("does not trust the Host when APP_ORIGIN is set", async () => {
    const server = await new TestApp({ db }).listen(0);
    try {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      const res = await new TestRequests(server).write("post", "/api/events", { Origin: `http://127.0.0.1:${port}` }).send(EVENTS);
      expect(res.status).toBe(403);
    } finally {
      server.close();
    }
  });

  // ルーティングは末尾の / と大文字小文字を区別するので、パスを変えてもガードをすり抜けてルートに当たらない
  // （Origin を付けても 404。付けなければ /api/ で始まるものは 403）
  it.each(["/api/events/", "/API/events", "/Api/options"])("does not route %s to a controller", async (path) => {
    const res = await http.write("post", path).send(EVENTS);
    expect(res.status).toBe(404);
    const { rows } = await pool.query("SELECT COUNT(*) AS n FROM events");
    expect(rows).toEqual([{ n: 0 }]);
  });

  it("compares Origin with the request host when APP_ORIGIN is not set (development)", async () => {
    const server = await new TestApp({ db, appOrigin: null }).listen(0);
    try {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      const local = new TestRequests(server);
      const ok = await local.write("post", "/api/events", { Origin: `http://127.0.0.1:${port}` }).send(EVENTS);
      const other = await local.write("post", "/api/events", { Origin: "http://localhost:1" }).send(EVENTS);
      expect([ok.status, other.status]).toEqual([202, 403]);
    } finally {
      server.close();
    }
  });
});

describe("Content-Type check", () => {
  it.each(["text/plain", "application/x-www-form-urlencoded"])("answers 400 to a JSON API sent as %s", async (type) => {
    const res = await http.write("post", "/api/options", { "Content-Type": type }).send('{"title":"a"}');
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
    const { rows } = await pool.query(USER_COUNT);
    expect(rows).toEqual([{ n: 0 }]);
  });

  it("answers 400 to a body without Content-Type", async () => {
    const server = await new TestApp({ db }).listen(0);
    try {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      // 型のない Blob は、fetch が Content-Type を付けない
      const body = new Blob(['{"title":"a"}']);
      const res = await fetch(`http://127.0.0.1:${port}/api/options`, { method: "POST", body, headers: { Origin: TEST_ORIGIN } });
      const { status } = res;
      expect([status, await res.json()]).toMatchObject([400, { error: { code: "VALIDATION_ERROR" } }]);
    } finally {
      server.close();
    }
  });

  it("answers 400 to multipart sent to a JSON API", async () => {
    const pending = http.write("post", "/api/events");
    const res = await pending.field("events", "[]");
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { code: "VALIDATION_ERROR", message: "本文は JSON（Content-Type: application/json）で送る" } });
  });

  it("lets multipart through to the photo upload (404 for a missing achievement, not 400)", async () => {
    const user = await users.create();
    const app = new TestApp({ db }).build();
    const { status } = await new SessionAgent(app, user.cookie).send((r) => {
      const pending = r.put("/api/achievements/999/photo");
      return pending.attach("photo", Buffer.from([0xff, 0xd8, 0xff]), "photo.jpg");
    });
    expect(status).toBe(404);
  });

  it("lets a write without a body through", async () => {
    const user = await users.create();
    const res = await http.write("delete", "/api/account", { Cookie: user.cookie });
    expect(res.status).toBe(204);
  });
});

describe("GET /api/metrics token", () => {
  it.each([
    ["no token", {}],
    ["a wrong token", { Authorization: "Bearer wrong" }],
  ])("answers the same 404 as an unknown path with %s", async (_name, headers) => {
    const res = await http.call("get", "/api/metrics", headers);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: "NOT_FOUND", message: "GET /api/metrics はない" } });
    expect(res.text).not.toContain("process_resident_memory_bytes");
  });

  it.each(["/api/metrics?x=1", "/api/metrics?format=text"])("answers %s without a token like an unknown path", async (path) => {
    const metrics = await http.call("get", path);
    const { text } = await http.call("get", path.replace("/api/metrics", "/api/nothing"));
    expect(metrics.status).toBe(404);
    expect(metrics.text).toBe(text.replace("/api/nothing", "/api/metrics"));
  });

  it("answers 404 even with a token when METRICS_TOKEN is empty", async () => {
    const empty = new TestRequests(new TestApp({ metricsToken: "" }).build());
    const res = await empty.call("get", "/api/metrics", { Authorization: "Bearer " });
    expect(res.status).toBe(404);
  });

  it("returns the metrics with the right token", async () => {
    const res = await http.call("get", "/api/metrics", { Authorization: TEST_METRICS_AUTH });
    expect(res.status).toBe(200);
    expect(res.text).toContain("process_resident_memory_bytes");
  });
});

describe("hiding internal details", () => {
  it.each(["staging", "production"] as const)("hides the message of /api/health/db when APP_ENV=%s", async (appEnv) => {
    const failing = new TestApp({ db: new FakeDatabase(new Error("connect ECONNREFUSED 10.0.0.5:5432")), appEnv }).build();
    const res = await new TestRequests(failing).call("get", "/api/health/db");
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: "error" });
    expect(res.text).not.toContain("ECONNREFUSED");
  });

  it("does not put the error into the 500 message", async () => {
    const throwing = new TestRequests(new TestApp({ controllers: [new ThrowingController()] }).build());
    const res = await throwing.call("get", "/api/test/unexpected");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: { code: "INTERNAL_ERROR", message: "サーバーで想定外のエラーが起きた" } });
    expect(res.text).not.toContain("boom");
  });

  it("marks API responses as no-store, including errors", async () => {
    const responses = [
      await http.call("get", "/api/suggestions"),
      await http.call("get", "/api/nothing"),
      await http.call("post", "/api/events").send(EVENTS),
    ];
    expect(responses.map(({ status, headers }) => [status, headers["cache-control"]])).toEqual([
      [200, "no-store"],
      [404, "no-store"],
      [403, "no-store"],
    ]);
  });
});

describe("write rate limits (api.md §6)", () => {
  it("answers 429 with Retry-After after 120 writes a minute from one account, and not to another account", async () => {
    const clock = new FixedClock(NOW);
    const limited = new TestApp({ db, clock }).build();
    const [a, b] = [await users.create(clock.now()), await users.create(clock.now())];
    const agent = new SessionAgent(limited, a.cookie);
    for (let i = 0; i < 120; i++) {
      const { status } = await agent.send((r) => r.post(MISSING_ACHIEVEMENT));
      expect(status).toBe(404);
    }
    const { status, headers, body } = await agent.send((r) => r.post(MISSING_ACHIEVEMENT));
    expect([status, headers["retry-after"]]).toEqual([429, "60"]);
    expect(body).toMatchObject({ error: { code: "TOO_MANY_REQUESTS" } });
    const other = await new SessionAgent(limited, b.cookie).send((r) => r.post(MISSING_ACHIEVEMENT));
    expect(other.status).toBe(404);
    // 読むのは数えない
    const read = await agent.send((r) => r.get("/api/options?status=pending"));
    expect(read.status).toBe(200);
    clock.advance(MINUTE_MS);
    const again = await agent.send((r) => r.post(MISSING_ACHIEVEMENT));
    expect(again.status).toBe(404);
  });

  it("answers 429 to POST /api/events after 20 requests a minute from one IP, with or without an account", async () => {
    const clock = new FixedClock(NOW);
    const limited = new TestApp({ db, clock }).build();
    const anonymous = new TestRequests(limited);
    const user = await users.create(clock.now());
    for (let i = 0; i < 19; i++) {
      const { status } = await anonymous.write("post", "/api/events").send(EVENTS);
      expect(status).toBe(202);
    }
    const withAccount = await new SessionAgent(limited, user.cookie).send((r) => r.post("/api/events").send(EVENTS));
    expect(withAccount.status).toBe(202);
    clock.advance(30 * 1000);
    const { status, headers } = await anonymous.write("post", "/api/events").send(EVENTS);
    expect([status, headers["retry-after"]]).toEqual([429, "30"]);
    clock.advance(30 * 1000);
    const again = await anonymous.write("post", "/api/events").send(EVENTS);
    expect(again.status).toBe(202);
  });

  it("issues the session cookie as __Host-ol_session with Secure when deployed (architecture.md §4.3、api.md §6)", async () => {
    const deployed = new TestRequests(new TestApp({ db, appEnv: "production" }).build());
    const { status, headers } = await deployed.write("post", "/api/options").send({ title: "a" });
    expect(status).toBe(201);
    expect(headers).toMatchObject({
      "set-cookie": [expect.stringMatching(/^__Host-ol_session=[^;]+;.*Path=\/;.*HttpOnly;.*Secure;.*SameSite=Lax/)],
    });
  });

  it("takes the IP from the last X-Forwarded-For hop when deployed (trust proxy 1. architecture.md §4.3)", async () => {
    const rateLimits = { events: { limit: 1, windowMs: MINUTE_MS }, writes: { limit: 1000, windowMs: MINUTE_MS }, photos: { limit: 1000, windowMs: MINUTE_MS } };
    const deployed = new TestRequests(new TestApp({ db, clock: new FixedClock(NOW), rateLimits, appEnv: "production" }).build());
    const send = (forwarded: string) => deployed.write("post", "/api/events", { "X-Forwarded-For": forwarded }).send(EVENTS);
    expect((await send("203.0.113.1")).status).toBe(202);
    // 利用者が書いた手前の値は信じない（Google のロードバランサーが最後に足したものを使う）
    expect((await send("198.51.100.9, 203.0.113.1")).status).toBe(429);
    expect((await send("203.0.113.2")).status).toBe(202);
  });

  it("counts photo uploads as writes but not restore (counted in the database) or writes without an account", async () => {
    const clock = new FixedClock(NOW);
    const rateLimits = { events: { limit: 1000, windowMs: MINUTE_MS }, writes: { limit: 2, windowMs: MINUTE_MS }, photos: { limit: 1000, windowMs: MINUTE_MS } };
    const limited = new TestApp({ db, clock, rateLimits }).build();
    const user = await users.create(clock.now());
    const agent = new SessionAgent(limited, user.cookie);
    const anonymous = new SessionAgent(limited);
    for (let i = 0; i < 3; i++) {
      const restore = await agent.send((r) => r.post("/api/account/restore").send({ code: "ABCD-EFGH-JKMN-PQRS" }));
      const noAccount = await anonymous.send((r) => r.post(MISSING_ACHIEVEMENT));
      expect([restore.status, noAccount.status]).toEqual([404, 404]);
    }
    const photo = await agent.send((r) => r.delete("/api/achievements/999/photo"));
    const write = await agent.send((r) => {
      const pending = r.put("/api/achievements/999/photo");
      return pending.attach("photo", Buffer.from([0xff, 0xd8, 0xff]), "photo.jpg");
    });
    const over = await agent.send((r) => r.post(MISSING_ACHIEVEMENT));
    expect([photo.status, write.status, over.status]).toEqual([404, 404, 429]);
  });

  // 写真の保存は、ほかの書き込みとは別に 1 時間 60 回まで（api.md §6）。ほかの書き込みは止めない
  it("limits photo uploads separately, with Retry-After", async () => {
    const clock = new FixedClock(NOW);
    const rateLimits = {
      events: { limit: 1000, windowMs: MINUTE_MS },
      writes: { limit: 1000, windowMs: MINUTE_MS },
      photos: { limit: 1, windowMs: 60 * MINUTE_MS },
    };
    const limited = new TestApp({ db, clock, rateLimits }).build();
    const user = await users.create(clock.now());
    const agent = new SessionAgent(limited, user.cookie);
    const upload = (): Promise<ApiResult> =>
      agent.send((r) => {
        const pending = r.put("/api/achievements/999/photo");
        return pending.attach("photo", Buffer.from([0xff, 0xd8, 0xff]), "photo.jpg");
      });
    const first = await upload();
    expect(first.status).toBe(404);
    const { status, headers } = await upload();
    expect([status, headers["retry-after"]]).toEqual([429, "3600"]);
    const other = await agent.send((r) => r.post(MISSING_ACHIEVEMENT));
    expect(other.status).toBe(404);
  });

  it("does not count POST /api/events in the per-account limit", async () => {
    const clock = new FixedClock(NOW);
    const rateLimits = { events: { limit: 1000, windowMs: MINUTE_MS }, writes: { limit: 1, windowMs: MINUTE_MS }, photos: { limit: 1000, windowMs: MINUTE_MS } };
    const limited = new TestApp({ db, clock, rateLimits }).build();
    const user = await users.create(clock.now());
    const agent = new SessionAgent(limited, user.cookie);
    await agent.send((r) => r.post("/api/events").send(EVENTS));
    const write = await agent.send((r) => r.post(MISSING_ACHIEVEMENT));
    expect(write.status).toBe(404);
  });
});
