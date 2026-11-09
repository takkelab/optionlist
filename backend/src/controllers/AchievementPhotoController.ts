import type { RequestHandler } from "express";
import multer from "multer";
import type { CurrentUser } from "../middleware/SessionLocals";
import type { AchievementPhotoUseCases } from "../services/AchievementPhotoService";
import { AppError } from "../services/errors";
import type { Controller, JsonResponse, Routes } from "./http";
import type { PathIdParser } from "./PathId";

type Params = { id?: string };
type UserId = number | null;

// 写真を返す口。Express の Response はこの形を満たす
export interface PhotoResponse {
  set(headers: Record<string, string>): PhotoResponse;
  send(body: Buffer): void;
}

const MAX_BYTES = 5 * 1024 * 1024;
// サーバーが決めた名前（UUID と拡張子）の形だけを受け付ける（パストラバーサル対策。api.md §5）
const FILENAME = /^[A-Za-z0-9-]{1,80}\.(jpg|png|webp)$/;
// 名前は置き換えのたびに変わるので、中身は変わらない（1 年キャッシュしてよい）。人ごとに違うので private と Vary: Cookie
// 写真に見せかけた HTML や SVG をブラウザに実行させない（nosniff と CSP の default-src 'none'。api.md §5、docs/decisions/0037）
const SERVE_HEADERS = {
  "Cache-Control": "private, max-age=31536000, immutable",
  Vary: "Cookie",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'",
  "Content-Disposition": "inline",
};

// 達成の写真（api.md §2・§5）。PUT は multipart の photo を受け取り、配信は /api/photos/<ファイル名>
// 配信は、そのファイル名が自分の達成の写真かを DB で（RLS の中で）確かめてから返す。違えば・なければ 404
export class AchievementPhotoController implements Controller {
  readonly #ids: PathIdParser;
  readonly #photos: AchievementPhotoUseCases;
  readonly #user: CurrentUser;

  constructor(ids: PathIdParser, photos: AchievementPhotoUseCases, user: CurrentUser) {
    this.#ids = ids;
    this.#photos = photos;
    this.#user = user;
  }

  register(router: Routes): void {
    router.put("/api/achievements/:id/photo", this.#receive(), (req, res) => {
      const { file } = req;
      return this.put(this.#user.of(res), req.params, file?.buffer, res);
    });
    router.delete("/api/achievements/:id/photo", (req, res) => this.remove(this.#user.of(res), req.params, res));
    router.get("/api/photos/:filename", (req, res) => {
      const { filename } = req.params;
      return this.serve(this.#user.of(res), typeof filename === "string" ? filename : undefined, res);
    });
  }

  async put(userId: UserId, params: Params, bytes: Buffer | undefined, res: JsonResponse): Promise<void> {
    const id = this.#id(params.id);
    if (bytes === undefined) throw new AppError("VALIDATION_ERROR", "写真（photo）が必要");
    res.status(200).json(await this.#photos.set(userId, id, bytes));
  }

  async remove(userId: UserId, params: Params, res: JsonResponse): Promise<void> {
    await this.#photos.remove(userId, this.#id(params.id));
    res.status(204).end();
  }

  async serve(userId: UserId, filename: string | undefined, res: PhotoResponse): Promise<void> {
    const photo = filename === undefined || !FILENAME.test(filename) ? null : await this.#photos.open(userId, filename);
    if (photo === null) throw this.#photoNotFound();
    const headers = res.set({ ...SERVE_HEADERS, "Content-Type": photo.contentType });
    headers.send(photo.bytes);
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

  #photoNotFound(): AppError {
    return new AppError("NOT_FOUND", "写真が見つからない");
  }
}
