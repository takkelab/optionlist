import express from "express";
import type { IRouter, RequestHandler } from "express";
import multer from "multer";
import type { AchievementPhotoUseCases } from "../services/AchievementPhotoService";
import { AppError } from "../services/errors";
import type { Controller, JsonResponse } from "./http";
import type { PathIdParser } from "./PathId";

type Params = { id?: string };

const MAX_BYTES = 5 * 1024 * 1024;
// 名前は置き換えのたびに変わるので、中身は変わらない（1 年キャッシュしてよい）
const CACHE_MAX_AGE = "365d";

// 達成の写真（api.md §2・§5）。PUT は multipart の photo を受け取り、配信は /api/photos/<ファイル名>
export class AchievementPhotoController implements Controller {
  readonly #ids: PathIdParser;
  readonly #photos: AchievementPhotoUseCases;
  readonly #directory: string;

  constructor(ids: PathIdParser, photos: AchievementPhotoUseCases, directory: string) {
    this.#ids = ids;
    this.#photos = photos;
    this.#directory = directory;
  }

  register(router: IRouter): void {
    router.put("/api/achievements/:id/photo", this.#receive(), (req, res) => {
      const { file } = req;
      return this.put(req.params, file?.buffer, res);
    });
    router.delete("/api/achievements/:id/photo", (req, res) => this.remove(req.params, res));
    router.use(
      "/api/photos",
      express.static(this.#directory, {
        index: false,
        immutable: true,
        maxAge: CACHE_MAX_AGE,
        // 判定するのは先頭のバイトだけなので、後ろに別の中身があってもブラウザに推測させない（api.md §5）
        setHeaders: (res) => res.setHeader("X-Content-Type-Options", "nosniff"),
      }),
    );
  }

  async put(params: Params, bytes: Buffer | undefined, res: JsonResponse): Promise<void> {
    const id = this.#id(params.id);
    if (bytes === undefined) throw new AppError("VALIDATION_ERROR", "写真（photo）が必要");
    res.status(200).json(await this.#photos.set(id, bytes));
  }

  async remove(params: Params, res: JsonResponse): Promise<void> {
    await this.#photos.remove(this.#id(params.id));
    res.status(204).end();
  }

  // 受け取りで起きるエラーは、大きすぎる・multipart として読めないなど、どれもリクエストの問題（メモリに受けるのでディスクは関係しない）
  #receive(): RequestHandler {
    const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES, files: 1, fields: 0, parts: 1 } }).single("photo");
    return (req, res, next) => {
      upload(req, res, (error: unknown) => {
        next(error === undefined || error === null ? undefined : new AppError("VALIDATION_ERROR", "写真は 5MB までの 1 枚"));
      });
    };
  }

  #id(value: unknown): number {
    const id = this.#ids.parse(value);
    if (id === null) throw new AppError("NOT_FOUND", `達成 ${String(value)} が見つからない`);
    return id;
  }
}
