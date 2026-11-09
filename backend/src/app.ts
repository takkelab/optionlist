import express from "express";
import type { Express } from "express";
import type { Server } from "node:http";
import type { Controller, Routes } from "./controllers/http";
import type { ErrorMiddleware, Middleware } from "./middleware/Middleware";

export interface HttpApp {
  build(): Express;
  listen(port: number): Promise<Server>;
}

export type AppDeps = {
  controllers: Controller[];
  requestMetrics: Middleware;
  // 本文を読む前に通す（Cache-Control・Origin・Content-Type。api.md §1）
  guards: Middleware[];
  // Cookie からそのリクエストの人を決める（api.md §6）
  session: Middleware;
  // 書き込みの回数の制限（api.md §6）。人を決めたあとに通す
  rateLimit: Middleware;
  notFound: Middleware;
  errorHandler: ErrorMiddleware;
};

// Express の設定。依存は server.ts（テストではフェイク）が組み立てて渡す。
// テストは build() の戻り値をそのまま supertest に渡し、server.ts は listen() で待ち受ける
export class ExpressApp implements HttpApp {
  readonly #controllers: Controller[];
  readonly #requestMetrics: Middleware;
  readonly #session: Middleware;
  readonly #guards: Middleware[];
  readonly #rateLimit: Middleware;
  readonly #notFound: Middleware;
  readonly #errorHandler: ErrorMiddleware;

  constructor(deps: AppDeps) {
    this.#controllers = deps.controllers;
    this.#requestMetrics = deps.requestMetrics;
    this.#session = deps.session;
    this.#guards = deps.guards;
    this.#rateLimit = deps.rateLimit;
    this.#notFound = deps.notFound;
    this.#errorHandler = deps.errorHandler;
  }

  build(): Express {
    const app = express();
    // ルートのパスは書いたとおりにだけ当てる（Express の既定は末尾の / と大文字小文字の違いも同じルートに当てるので、
    // /api/events/ や /API/options が、パスで判定する Origin の確認・回数の制限をすり抜けてしまう。docs/decisions/0050）
    app.set("strict routing", true);
    app.set("case sensitive routing", true);
    app.use(this.#requestMetrics.handler());
    for (const guard of this.#guards) app.use(guard.handler());
    app.use(express.json({ limit: "1mb" }));
    app.use(this.#session.handler());
    app.use(this.#rateLimit.handler());
    this.routes(app);
    app.use("/api", this.#notFound.handler());
    app.use(this.#errorHandler.handler());
    return app;
  }

  // すべての controllers のルートを router に登録する。分離テスト（testing.md §7）は記録用のフェイクを渡して、ルートの一覧を集める
  routes(router: Routes): void {
    for (const controller of this.#controllers) {
      controller.register(router);
    }
  }

  // 待ち受けを始めたら resolve、ポートが使えないなど（EADDRINUSE）は reject
  // reject のリスナーは待ち受けを始めたら外す（起動後のエラーを決着済みの Promise に吸い込ませない）
  listen(port: number): Promise<Server> {
    return new Promise((resolve, reject) => {
      const server = this.build().listen(port);
      server.once("error", reject);
      server.once("listening", () => {
        server.off("error", reject);
        resolve(server);
      });
    });
  }
}
