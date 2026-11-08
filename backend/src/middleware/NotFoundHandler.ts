import type { RequestHandler } from "express";
import type { ApiError } from "../../../shared/types";
import type { Middleware } from "./Middleware";

// どのルートにも当たらなかった /api/* を 404 NOT_FOUND の JSON で返す（Express 既定の HTML の "Cannot GET" にしない）
export class NotFoundHandler implements Middleware {
  handler(): RequestHandler {
    return (req, res) => {
      const body: ApiError = { error: { code: "NOT_FOUND", message: `${req.method} ${req.originalUrl} はない` } };
      res.status(404).json(body);
    };
  }
}
