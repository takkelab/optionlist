import express from "express";
import type { Express } from "express";
import type { Server } from "node:http";
import type { Controller } from "./controllers/http";
import type { ErrorMiddleware, Middleware } from "./middleware/Middleware";

export interface HttpApp {
  build(): Express;
  listen(port: number): Promise<Server>;
}

export type AppDeps = {
  controllers: Controller[];
  requestMetrics: Middleware;
  notFound: Middleware;
  errorHandler: ErrorMiddleware;
};

// Express の設定。依存は server.ts（テストではフェイク）が組み立てて渡す。
// テストは build() の戻り値をそのまま supertest に渡し、server.ts は listen() で待ち受ける
export class ExpressApp implements HttpApp {
  readonly #controllers: Controller[];
  readonly #requestMetrics: Middleware;
  readonly #notFound: Middleware;
  readonly #errorHandler: ErrorMiddleware;

  constructor(deps: AppDeps) {
    this.#controllers = deps.controllers;
    this.#requestMetrics = deps.requestMetrics;
    this.#notFound = deps.notFound;
    this.#errorHandler = deps.errorHandler;
  }

  build(): Express {
    const app = express();
    app.use(this.#requestMetrics.handler());
    app.use(express.json({ limit: "1mb" }));
    for (const controller of this.#controllers) {
      controller.register(app);
    }
    app.use("/api", this.#notFound.handler());
    app.use(this.#errorHandler.handler());
    return app;
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
