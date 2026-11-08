import type { Request, RequestHandler, Response } from "express";
import type { RequestMetrics } from "../metrics/AppMetrics";
import type { Middleware } from "./Middleware";

// 応答を返し終えたときに http_request_duration_seconds と http_requests_total を記録する
// route ラベルはルートの定義（/api/options/:id）にする。どのルートにも当たらなかったものは "unmatched" にまとめ、
// 存在しない URL でラベルの種類が増えないようにする（docs/decisions/0007）
export class RequestMetricsRecorder implements Middleware {
  readonly #metrics: RequestMetrics;

  constructor(metrics: RequestMetrics) {
    this.#metrics = metrics;
  }

  handler(): RequestHandler {
    return (req, res, next) => {
      const started = performance.now();
      res.once("finish", () => this.#record(req, res, started));
      next();
    };
  }

  #record(req: Request, res: Response, started: number): void {
    const { route } = req;
    const labels = {
      method: req.method,
      route: route === undefined ? "unmatched" : String(route.path),
      status: String(res.statusCode),
    };
    this.#metrics.observeRequest(labels, (performance.now() - started) / 1000);
  }
}
