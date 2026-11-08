import type { HealthChecker } from "../services/HealthService";
import type { Controller, JsonResponse, Routes } from "./http";

// GET /api/health（backend の疎通）と GET /api/health/db（DB の疎通。届かなければ 503）
export class HealthController implements Controller {
  readonly #health: HealthChecker;

  constructor(health: HealthChecker) {
    this.#health = health;
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
    res.status(result.status === "ok" ? 200 : 503).json(result);
  }
}
