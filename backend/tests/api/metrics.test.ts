import request from "supertest";
import { describe, expect, it } from "vitest";
import { TestApp } from "../fakes/TestApp";
import { TestRequests } from "../fakes/TestRequests";

// GET /api/metrics（metrics.md §5）
describe("GET /api/metrics", () => {
  it("returns the Prometheus text format with the default metrics", async () => {
    const res = await new TestRequests(new TestApp().build()).metrics();
    expect(res.status).toBe(200);
    expect(res.type).toBe("text/plain");
    expect(res.text).toContain("process_resident_memory_bytes");
    expect(res.text).toContain("# TYPE http_request_duration_seconds histogram");
  });

  it("counts requests by route definition and status", async () => {
    const app = new TestApp().build();
    await request(app).get("/api/health");
    await request(app).get("/api/health");
    await request(app).get("/api/nothing");

    const { text } = await new TestRequests(app).metrics();
    expect(text).toContain('http_requests_total{method="GET",route="/api/health",status="200"} 2');
    expect(text).toContain('http_requests_total{method="GET",route="unmatched",status="404"} 1');
    expect(text).toContain('http_request_duration_seconds_count{method="GET",route="/api/health",status="200"} 2');
  });
});
