import type { RequestHandler } from "express";
import type { Middleware } from "./Middleware";

// 画面の応答に付けるヘッダー（architecture.md §4.3。docs/decisions/0038）。外のスクリプト・フォント・計測タグは読まない
// /api の応答には付けない（JSON は画面として描かない。写真の配信は自分で CSP を付ける。api.md §5）
const SCREEN_HEADERS: ReadonlyArray<[string, string]> = [
  [
    "Content-Security-Policy",
    "default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  ],
  ["Strict-Transport-Security", "max-age=31536000"],
  ["Referrer-Policy", "same-origin"],
  ["X-Content-Type-Options", "nosniff"],
  ["Permissions-Policy", "camera=(), microphone=(), geolocation=()"],
];

// /api と /api/…（どちらも app.ts の /api の 404 か API のルートに当たる）
const API = /^\/api(\/|$)/;

// 画面のセキュリティのヘッダーと、公開の 2 段目までの noindex（docs/decisions/0045）
// publicIndexing が false なら、/api を含むすべての応答に X-Robots-Tag: noindex を付ける
export class ScreenHeaders implements Middleware {
  readonly #publicIndexing: boolean;

  constructor(publicIndexing: boolean) {
    this.#publicIndexing = publicIndexing;
  }

  handler(): RequestHandler {
    return (req, res, next) => {
      const { path } = req;
      if (!this.#publicIndexing) res.setHeader("X-Robots-Tag", "noindex");
      if (!API.test(path)) {
        for (const [name, value] of SCREEN_HEADERS) res.setHeader(name, value);
      }
      next();
    };
  }
}
