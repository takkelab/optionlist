import { describe, expect, it } from "vitest";
import { MetricsController } from "../../src/controllers/MetricsController";
import { AppError } from "../../src/services/errors";
import { FakeMetricsExporter } from "../fakes/FakeMetricsExporter";
import { FakeResponse } from "../fakes/FakeResponse";

describe("MetricsController", () => {
  it("sends the exported text with its content type when the token matches", async () => {
    const res = new FakeResponse();
    await new MetricsController(new FakeMetricsExporter("up 1\n"), "secret").metrics("Bearer secret", "GET /api/metrics", res);
    expect(res.contentType()).toBe("text/plain; version=0.0.4; charset=utf-8");
    expect(res.body()).toBe("up 1\n");
  });

  it.each([
    ["no header", "secret", undefined],
    ["a wrong token", "secret", "Bearer wrong"],
    ["the token without Bearer", "secret", "secret"],
    ["no token configured", "", "Bearer "],
  ])("throws NOT_FOUND for %s", async (_name, token, authorization) => {
    const res = new FakeResponse();
    const failed = new MetricsController(new FakeMetricsExporter("up 1\n"), token).metrics(authorization, "GET /api/metrics", res);
    await expect(failed).rejects.toBeInstanceOf(AppError);
    expect(res.body()).toBeUndefined();
  });
});
