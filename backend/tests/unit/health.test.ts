import { describe, expect, it } from "vitest";
import { HealthController } from "../../src/controllers/HealthController";
import { HealthService } from "../../src/services/HealthService";
import { FakeHealthChecker, FakeHealthStore } from "../fakes/FakeHealth";
import { FakeResponse } from "../fakes/FakeResponse";

describe("HealthService.checkDb", () => {
  it("returns ok when the store answers", async () => {
    expect(await new HealthService(new FakeHealthStore()).checkDb()).toEqual({ status: "ok" });
  });

  it("returns the error message when the store fails", async () => {
    const service = new HealthService(new FakeHealthStore(new Error("connect ECONNREFUSED")));
    expect(await service.checkDb()).toEqual({ status: "error", message: "connect ECONNREFUSED" });
  });

  it("stringifies values that are not Error", async () => {
    expect(await new HealthService(new FakeHealthStore("down")).checkDb()).toEqual({ status: "error", message: "down" });
  });
});

describe("HealthController", () => {
  it("answers ok for the server", () => {
    const res = new FakeResponse();
    new HealthController(new FakeHealthChecker({ status: "ok" })).server(res);
    expect(res.statusCode()).toBe(200);
    expect(res.body()).toEqual({ status: "ok" });
  });

  it("answers 200 when the database is reachable", async () => {
    const res = new FakeResponse();
    await new HealthController(new FakeHealthChecker({ status: "ok" })).database(res);
    expect(res.statusCode()).toBe(200);
    expect(res.body()).toEqual({ status: "ok" });
  });

  it("answers 503 with the reason when the database is unreachable", async () => {
    const res = new FakeResponse();
    const result = { status: "error", message: "timeout" } as const;
    await new HealthController(new FakeHealthChecker(result)).database(res);
    expect(res.statusCode()).toBe(503);
    expect(res.body()).toEqual(result);
  });
});
