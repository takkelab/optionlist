import express from "express";
import type { RequestHandler, Response } from "express";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Middleware } from "./Middleware";

// 名前にハッシュが付いたファイル（Vite が assets/ に出す）は変わらないので 1 年キャッシュさせる
const HASHED = /^\/assets\//;
const IMMUTABLE = "public, max-age=31536000, immutable";
// index.html・Service Worker・manifest・アイコンは、毎回サーバーに確かめさせる
const NO_CACHE = "no-cache";
const NOINDEX_META = '<meta name="robots" content="noindex">';
const SAFE_METHODS = new Set(["GET", "HEAD"]);

// ビルド済みの frontend（frontend/dist）を配る（architecture.md §4.3）。/api の 404 のあとに置く
// ファイルに当たらない GET・HEAD は index.html を返す（画面のルーティング。/suggestions/1 など）
// publicIndexing が false なら、返す index.html の <head> に noindex の meta を差し込む（ビルドには入れない。docs/decisions/0045）
export class FrontendFiles implements Middleware {
  readonly #dist: string;
  readonly #indexHtml: string;

  constructor(dist: string, publicIndexing: boolean) {
    this.#dist = dist;
    // 起動時に 1 回だけ読む。なければ起動の時点で止まる（画面のないイメージを出さない）
    const html = readFileSync(path.join(dist, "index.html"), "utf8");
    this.#indexHtml = publicIndexing ? html : html.replace("<head>", `<head>\n    ${NOINDEX_META}`);
  }

  handler(): RequestHandler {
    const files = express.static(this.#dist, { index: false, setHeaders: (res, file) => this.#cache(res, file) });
    return (req, res, next) => {
      if (!SAFE_METHODS.has(req.method)) {
        next();
        return;
      }
      // /index.html を直接開かれても、meta を差し込んだものを返す
      if (req.path === "/index.html") {
        this.#sendIndex(res);
        return;
      }
      files(req, res, (error?: unknown) => {
        if (error !== undefined) {
          next(error);
          return;
        }
        // 古い版のタブが消えたチャンクを読みに来たときに、HTML を JS として渡さない（SW のキャッシュにも残さない。docs/decisions/0054）
        if (HASHED.test(req.path)) {
          res.setHeader("Cache-Control", NO_CACHE);
          res.status(404);
          res.type("text").send("Not Found");
          return;
        }
        this.#sendIndex(res);
      });
    };
  }

  #sendIndex(res: Response): void {
    res.setHeader("Cache-Control", NO_CACHE);
    res.type("html").send(this.#indexHtml);
  }

  #cache(res: Response, file: string): void {
    const relative = `/${path.relative(this.#dist, file).split(path.sep).join("/")}`;
    res.setHeader("Cache-Control", HASHED.test(relative) ? IMMUTABLE : NO_CACHE);
  }
}
