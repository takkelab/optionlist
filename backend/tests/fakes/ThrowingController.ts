import type { Controller, Routes } from "../../src/controllers/http";
import { AppError } from "../../src/services/errors";

// 共通のエラーハンドラを試すためのルート
// - GET /api/test/unexpected: 想定外のエラー（async ハンドラの reject）
// - GET /api/test/conflict: AppError（CONFLICT）
export class ThrowingController implements Controller {
  register(router: Routes): void {
    router.get("/api/test/unexpected", () => this.unexpected());
    router.get("/api/test/conflict", () => this.conflict());
  }

  async unexpected(): Promise<void> {
    throw new Error("boom");
  }

  conflict(): void {
    throw new AppError("CONFLICT", "すでに追加済み");
  }
}
