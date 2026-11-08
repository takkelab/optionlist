import request from "supertest";
import { describe, expect, it } from "vitest";
import { FakeDatabase } from "../fakes/FakeDatabase";
import { TestApp } from "../fakes/TestApp";
import { ThrowingController } from "../fakes/ThrowingController";

// 共通のエラーハンドラ（api.md §1・§3、testing.md §2）
describe("error handling", () => {
  it("returns 500 INTERNAL_ERROR, logs the error and counts it on unexpected errors", async () => {
    const testApp = new TestApp({ controllers: [new ThrowingController()] });
    const app = testApp.build();

    const res = await request(app).get("/api/test/unexpected");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: { code: "INTERNAL_ERROR", message: "サーバーで想定外のエラーが起きた" } });
    expect(testApp.loggedErrors()).toHaveLength(1);

    // エラーで終わっても route ラベルはルートの定義のまま（docs/decisions/0007）
    const metrics = await request(app).get("/api/metrics");
    expect(metrics.text).toMatch(/^unhandled_errors_total 1$/m);
    expect(metrics.text).toContain('http_requests_total{method="GET",route="/api/test/unexpected",status="500"} 1');
  });

  it("returns the status and code of AppError without counting it as unhandled", async () => {
    const testApp = new TestApp({ controllers: [new ThrowingController()] });
    const app = testApp.build();

    const res = await request(app).get("/api/test/conflict");
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: { code: "CONFLICT", message: "すでに追加済み" } });
    expect(testApp.loggedErrors()).toHaveLength(0);

    const metrics = await request(app).get("/api/metrics");
    expect(metrics.text).toMatch(/^unhandled_errors_total 0$/m);
  });

  it("returns 400 VALIDATION_ERROR for a malformed JSON body", async () => {
    const req = request(new TestApp().build()).post("/api/health");
    req.set("Content-Type", "application/json");
    const res = await req.send("{ not json");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: "VALIDATION_ERROR", message: "リクエストの本文を読めない" } });
  });

  it("returns 404 NOT_FOUND as JSON for an unknown /api path", async () => {
    const res = await request(new TestApp().build()).get("/api/nothing");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: "NOT_FOUND", message: "GET /api/nothing はない" } });
  });
});

// options の API で、409・404 に変えない DB のエラーは想定外として扱う（testing.md §2）
describe("unexpected database errors on the options API", () => {
  it.each([
    ["GET", "/api/options?status=pending", undefined],
    ["POST", "/api/options", { title: "a" }],
  ])("returns 500 and counts it for %s %s", async (method, path, body) => {
    const testApp = new TestApp({ db: new FakeDatabase(new Error("connection lost")) });
    const app = testApp.build();
    const req = method === "GET" ? request(app).get(path) : request(app).post(path).send(body);
    const res = await req;
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: { code: "INTERNAL_ERROR", message: "サーバーで想定外のエラーが起きた" } });
    expect(testApp.loggedErrors()).toHaveLength(1);
    const metrics = await request(app).get("/api/metrics");
    expect(metrics.text).toMatch(/^unhandled_errors_total 1$/m);
  });
});
