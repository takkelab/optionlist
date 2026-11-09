import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { HttpGetter, HttpReply } from "../lib/image-smoke.ts";
import { ContainerDatabaseUrl, ImageSmokeChecks } from "../lib/image-smoke.ts";

// パスごとに決まった応答を返す。ないパスは 404
class FakeHttp implements HttpGetter {
  readonly #replies: Record<string, HttpReply>;

  constructor(replies: Record<string, HttpReply>) {
    this.#replies = replies;
  }

  async get(path: string): Promise<HttpReply> {
    return this.#replies[path] ?? { status: 404, headers: {}, body: "" };
  }
}

const CSP = "default-src 'self'; img-src 'self' blob: data:";
const META = '<meta name="robots" content="noindex">';
const html = (withMeta: boolean) => `<html><head>${withMeta ? META : ""}</head><body><div id="root"></div></body></html>`;
const screen = (noindex: boolean): HttpReply => ({
  status: 200,
  headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": CSP, ...(noindex ? { "x-robots-tag": "noindex" } : {}) },
  body: html(noindex),
});
const health = (noindex: boolean): HttpReply => ({ status: 200, headers: noindex ? { "x-robots-tag": "noindex" } : {}, body: '{"status":"ok"}' });
const server = (noindex: boolean) => ({
  "/api/health": health(noindex),
  "/api/health/db": health(noindex),
  "/": screen(noindex),
  "/suggestions/1": screen(noindex),
});

describe("ImageSmokeChecks", () => {
  it("noindex の状態で決めたとおりに答えれば合格", async () => {
    assert.deepEqual(await new ImageSmokeChecks(new FakeHttp(server(true))).hidden(), []);
  });

  it("PUBLIC_INDEXING=true で noindex がなければ合格", async () => {
    assert.deepEqual(await new ImageSmokeChecks(new FakeHttp(server(false))).indexed(), []);
  });

  it("noindex のヘッダー・meta がない、/api/metrics が 200 なら不合格", async () => {
    const replies = { ...server(false), "/api/metrics": { status: 200, headers: {}, body: "" } };
    const problems = await new ImageSmokeChecks(new FakeHttp(replies)).hidden();
    assert.equal(problems.length, 3);
    assert.match(problems.join("\n"), /X-Robots-Tag: noindex がない/);
    assert.match(problems.join("\n"), /noindex の meta がない/);
    assert.match(problems.join("\n"), /\/api\/metrics がトークンなしで 200/);
  });

  it("PUBLIC_INDEXING=true なのに noindex が残っていれば不合格", async () => {
    const problems = await new ImageSmokeChecks(new FakeHttp(server(true))).indexed();
    assert.ok(problems.some((p) => p.includes("/ に X-Robots-Tag がある")));
    assert.ok(problems.some((p) => p.includes("/ の本文に noindex がある")));
  });

  it("CSP がない、DB につながらない、画面のパスが index.html でなければ不合格", async () => {
    const replies = {
      ...server(true),
      "/api/health/db": { status: 503, headers: {}, body: '{"status":"error"}' },
      "/": { ...screen(true), headers: { "x-robots-tag": "noindex" } },
      "/suggestions/1": { status: 404, headers: {}, body: "" },
    };
    const problems = await new ImageSmokeChecks(new FakeHttp(replies)).hidden();
    assert.deepEqual(
      problems.map((p) => p.split("（")[0].split(":")[0]),
      ["/api/health/db が 503", "/ に Content-Security-Policy がない", "/suggestions/1 が index.html を返さない"],
    );
  });
});

describe("ContainerDatabaseUrl", () => {
  it("手元を指す接続先だけを host.docker.internal に向け直す", () => {
    const urls = new ContainerDatabaseUrl();
    assert.equal(
      urls.rewrite("postgres://ol_app:ol_app@127.0.0.1:5432/optionlist_test?sslmode=disable"),
      "postgres://ol_app:ol_app@host.docker.internal:5432/optionlist_test?sslmode=disable",
    );
    assert.equal(urls.rewrite("postgres://u:p@localhost:5432/db"), "postgres://u:p@host.docker.internal:5432/db");
    assert.equal(urls.rewrite("postgres://u:p@db.internal:5432/db"), "postgres://u:p@db.internal:5432/db");
  });
});
