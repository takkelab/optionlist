import type { MetricsExporter } from "../metrics/AppMetrics";
import type { Controller, TextResponse, Routes } from "./http";

// GET /api/metrics（metrics.md §5。Prometheus のテキスト形式）
export class MetricsController implements Controller {
  readonly #metrics: MetricsExporter;

  constructor(metrics: MetricsExporter) {
    this.#metrics = metrics;
  }

  register(router: Routes): void {
    router.get("/api/metrics", (_req, res) => this.metrics(res));
  }

  async metrics(res: TextResponse): Promise<void> {
    const body = await this.#metrics.render();
    res.type(this.#metrics.contentType()).send(body);
  }
}
