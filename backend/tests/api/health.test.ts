import request from "supertest";
import { describe, expect, it } from "vitest";
import { TestApp } from "../fakes/TestApp";

describe("GET /api/health", () => {
  it("returns ok", async () => {
    const res = await request(new TestApp().build()).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });
});
