import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { TestApp } from "../fakes/TestApp";

// Express がビルド済みの frontend も配る（architecture.md §4.3。docs/decisions/0038・0045）
const dist = mkdtempSync(path.join(tmpdir(), "optionlist-dist-"));
mkdirSync(path.join(dist, "assets"));
writeFileSync(path.join(dist, "index.html"), "<!doctype html>\n<html>\n  <head>\n    <title>OptionList</title>\n  </head>\n  <body></body>\n</html>\n");
writeFileSync(path.join(dist, "assets", "index-abc123.js"), "console.log(1)");
writeFileSync(path.join(dist, "sw.js"), "self.addEventListener('fetch', () => {})");
const NOINDEX_META = '<meta name="robots" content="noindex">';
const CSP =
  "default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
const hidden = request(new TestApp({ frontendDist: dist }).build());
const indexed = request(new TestApp({ frontendDist: dist, publicIndexing: true }).build());

afterAll(() => {
  rmSync(dist, { recursive: true, force: true });
});

describe("serving the built frontend", () => {
  it.each(["/", "/suggestions/1", "/done", "/index.html"])("answers %s with index.html, not cached", async (url) => {
    const { status, headers, text } = await hidden.get(url);
    expect(status).toBe(200);
    expect(headers).toMatchObject({ "content-type": expect.stringMatching(/^text\/html/), "cache-control": "no-cache" });
    expect(text).toContain("<title>OptionList</title>");
  });

  it("caches hashed assets for a year and the Service Worker not at all", async () => {
    const asset = await hidden.get("/assets/index-abc123.js");
    expect(asset).toMatchObject({ status: 200, headers: { "cache-control": "public, max-age=31536000, immutable" } });
    const sw = await hidden.get("/sw.js");
    expect(sw).toMatchObject({ status: 200, headers: { "cache-control": "no-cache" } });
  });

  it("answers HEAD on a screen path like GET, without a body", async () => {
    const { status, headers, text } = await hidden.head("/suggestions/1");
    expect(status).toBe(200);
    expect(headers).toMatchObject({ "content-type": expect.stringMatching(/^text\/html/), "cache-control": "no-cache" });
    expect(text ?? "").toBe("");
  });

  it("answers a missing hashed asset with 404, not index.html (old tabs after a new release)", async () => {
    const { status, headers, text } = await hidden.get("/assets/index-old999.js");
    expect(status).toBe(404);
    expect(headers).not.toMatchObject({ "content-type": expect.stringMatching(/html/) });
    expect(text).not.toContain("<title>OptionList</title>");
  });

  it("stops at startup when the folder has no index.html", () => {
    const empty = mkdtempSync(path.join(tmpdir(), "optionlist-empty-dist-"));
    try {
      expect(() => new TestApp({ frontendDist: empty }).build()).toThrow(/index\.html/);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it("puts the security headers on screens", async () => {
    const { headers } = await hidden.get("/");
    expect(headers).toMatchObject({
      "content-security-policy": CSP,
      "strict-transport-security": "max-age=31536000",
      "referrer-policy": "same-origin",
      "x-content-type-options": "nosniff",
      "permissions-policy": "camera=(), microphone=(), geolocation=()",
    });
  });

  it.each(["/api/nope", "/api"])("keeps %s a JSON 404 without the screen CSP", async (url) => {
    const { status, body, headers } = await hidden.get(url);
    expect(status).toBe(404);
    expect(body).toMatchObject({ error: { code: "NOT_FOUND" } });
    expect(headers).not.toHaveProperty("content-security-policy");
  });

  it("does not answer writes to screen paths with index.html", async () => {
    const { status, text } = await hidden.post("/");
    expect(status).toBe(404);
    expect(text).not.toContain("<title>OptionList</title>");
  });
});

describe("noindex until the public launch (PUBLIC_INDEXING)", () => {
  it("marks every response noindex and adds the meta to index.html", async () => {
    const screen = await hidden.get("/suggestions/1");
    expect(screen).toMatchObject({ headers: { "x-robots-tag": "noindex" }, text: expect.stringContaining(`<head>\n    ${NOINDEX_META}`) });
    const api = await hidden.get("/api/health");
    expect(api).toMatchObject({ headers: { "x-robots-tag": "noindex" } });
  });

  it.each(["/", "/index.html", "/api/health"])("drops both the header and the meta on %s with PUBLIC_INDEXING=true", async (url) => {
    const { headers, text } = await indexed.get(url);
    expect(headers).not.toHaveProperty("x-robots-tag");
    expect(text).not.toContain("noindex");
  });
});
