import type { Request, RequestHandler } from "express";
import { AppError } from "../services/errors";
import type { Middleware } from "./Middleware";

const SAFE_METHODS = new Set(["GET", "HEAD"]);
// PUT /api/achievements/:id/photo（AchievementPhotoController と同じパス。ルーティングは大文字小文字と末尾の / を区別する）
const PHOTO_UPLOAD = /^\/api\/achievements\/[^/]+\/photo$/;

// /api の書き込みか（GET・HEAD 以外）
export interface ApiWriteCheck {
  isWrite(req: Request): boolean;
}

export class ApiRequests implements ApiWriteCheck {
  isWrite(req: Request): boolean {
    const { path, method } = req;
    return path.startsWith("/api/") && !SAFE_METHODS.has(method);
  }
}

// API の応答はキャッシュさせない（api.md §1）。写真の配信は sendFile の headers で private のキャッシュに置き換える（api.md §5）
export class ApiNoStore implements Middleware {
  handler(): RequestHandler {
    return (req, res, next) => {
      const { path } = req;
      if (path.startsWith("/api/")) res.setHeader("Cache-Control", "no-store");
      next();
    };
  }
}

// CSRF 対策（api.md §1。docs/decisions/0038・0050）。/api の書き込みは、Origin が自分のオリジンと一致しなければ 403
// Origin がない書き込みも 403（今のブラウザは同じオリジンの書き込みにも Origin を付ける）
// 自分のオリジン: APP_ORIGIN があればそれ（確認用・本番は必須）。なければ（手元・テスト）リクエストの Host から作る
// （frontend/vite.config.ts の proxy は changeOrigin: false で Host を変えないので、5173・4174・dev:lan の IP の画面もそのまま通る）
export class OriginGuard implements Middleware {
  readonly #origin: string | null;
  readonly #requests: ApiWriteCheck;

  constructor(origin: string | null, requests: ApiWriteCheck) {
    this.#origin = origin;
    this.#requests = requests;
  }

  handler(): RequestHandler {
    return (req, _res, next) => {
      if (!this.#requests.isWrite(req) || req.get("origin") === this.#expected(req)) {
        next();
        return;
      }
      next(new AppError("FORBIDDEN", "別のサイトからの書き込みは受け付けない"));
    };
  }

  #expected(req: Request): string {
    return this.#origin ?? `${req.protocol}://${req.get("host") ?? ""}`;
  }
}

// 本文のある書き込みは JSON（写真のアップロードだけ multipart）でなければ 400（api.md §1。docs/decisions/0050）
// フォームの POST（text/plain・application/x-www-form-urlencoded）を JSON の API に通さない
export class JsonContentType implements Middleware {
  readonly #requests: ApiWriteCheck;

  constructor(requests: ApiWriteCheck) {
    this.#requests = requests;
  }

  handler(): RequestHandler {
    return (req, _res, next) => {
      if (!this.#requests.isWrite(req) || !this.#hasBody(req) || req.is(this.#accepted(req)) !== false) {
        next();
        return;
      }
      next(new AppError("VALIDATION_ERROR", "本文は JSON（Content-Type: application/json）で送る"));
    };
  }

  // multipart を受けるのは写真のアップロードだけ（api.md §1・§5）
  #accepted(req: Request): string[] {
    const { path, method } = req;
    return method === "PUT" && PHOTO_UPLOAD.test(path) ? ["multipart/form-data"] : ["application/json"];
  }

  #hasBody(req: Request): boolean {
    const length = req.get("content-length");
    return req.get("transfer-encoding") !== undefined || (length !== undefined && length !== "0");
  }
}
