import { createHash, timingSafeEqual } from "node:crypto";
import type { MetricsExporter } from "../metrics/AppMetrics";
import { AppError } from "../services/errors";
import type { Controller, TextResponse, Routes } from "./http";

// GET /api/metrics（metrics.md §5。Prometheus のテキスト形式）
// Authorization: Bearer <METRICS_TOKEN> が合わなければ、どのルートにも当たらないときと同じ 404（あることも見せない。docs/decisions/0038）
// token が空なら、いつも 404
export class MetricsController implements Controller {
  readonly #metrics: MetricsExporter;
  readonly #token: string;

  constructor(metrics: MetricsExporter, token: string) {
    this.#metrics = metrics;
    this.#token = token;
  }

  register(router: Routes): void {
    router.get("/api/metrics", (req, res) => this.metrics(req.get("authorization"), `${req.method} ${req.originalUrl}`, res));
  }

  // request は NotFoundHandler と同じ「メソッド URL」（404 の本文を、どのルートにも当たらないときと同じにする）
  async metrics(authorization: string | undefined, request: string, res: TextResponse): Promise<void> {
    if (!this.#authorized(authorization)) throw new AppError("NOT_FOUND", `${request} はない`);
    const body = await this.#metrics.render();
    res.type(this.#metrics.contentType()).send(body);
  }

  // 長さの違いで時間が変わらないよう、ハッシュにしてから比べる
  #authorized(authorization: string | undefined): boolean {
    if (this.#token === "" || authorization === undefined) return false;
    return timingSafeEqual(this.#digest(authorization), this.#digest(`Bearer ${this.#token}`));
  }

  #digest(value: string): Buffer {
    const hash = createHash("sha256");
    hash.update(value);
    return hash.digest();
  }
}
