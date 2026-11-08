import { describe, expect, it } from "vitest";
import { MetricsController } from "../../src/controllers/MetricsController";
import { FakeMetricsExporter } from "../fakes/FakeMetricsExporter";
import { FakeResponse } from "../fakes/FakeResponse";

describe("MetricsController", () => {
  it("sends the exported text with its content type", async () => {
    const res = new FakeResponse();
    await new MetricsController(new FakeMetricsExporter("up 1\n")).metrics(res);
    expect(res.contentType()).toBe("text/plain; version=0.0.4; charset=utf-8");
    expect(res.body()).toBe("up 1\n");
  });
});
