import type { HealthChecker } from "../services/HealthService";
import type { Controller, JsonResponse, Routes } from "./http";

// GET /api/health（backend の疎通）と GET /api/health/db（DB の疎通。届かなければ 503）
// exposeErrors が false（確認用・本番）なら、503 の本文に message を入れない（接続先やエラーの中身を外に出さない。docs/decisions/0038）
export class HealthController implements Controller {
  readonly #health: HealthChecker;
  readonly #exposeErrors: boolean;

  constructor(health: HealthChecker, exposeErrors: boolean) {
    this.#health = health;
    this.#exposeErrors = exposeErrors;
  }

  register(router: Routes): void {
    router.get("/api/health", (_req, res) => this.server(res));
    router.get("/api/health/db", (_req, res) => this.database(res));
  }

  server(res: JsonResponse): void {
    res.json({ status: "ok" });
  }

  async database(res: JsonResponse): Promise<void> {
    const result = await this.#health.checkDb();
    if (result.status === "ok") res.status(200).json(result);
    else res.status(503).json(this.#exposeErrors ? result : { status: "error" });
  }
}
