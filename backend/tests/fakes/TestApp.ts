import type { Express } from "express";
import type { Server } from "node:http";
import { AppAssembly } from "../../src/AppAssembly";
import type { ExpressApp, HttpApp } from "../../src/app";
import type { Controller, Routes } from "../../src/controllers/http";
import type { Database, UserScopes } from "../../src/infra/PgDatabase";
import { PromMetrics } from "../../src/metrics/PromMetrics";
import type { PhotoFiles } from "../../src/repositories/LocalPhotoFiles";
import { RandomSessionKeys } from "../../src/services/AccountService";
import type { SessionKeySource } from "../../src/services/AccountService";
import type { Clock } from "../../src/services/Clock";
import { SystemClock } from "../../src/services/Clock";
import { FakeDatabase } from "./FakeDatabase";
import { FakeLogger } from "./FakeLogger";
import { FakePhotoFiles } from "./FakePhotoFiles";

export type TestDb = Database & UserScopes;

export type TestAppOptions = {
  db?: TestDb;
  // セッションの SQL（auth_find_user など）を流す DB。性能テストは、数えない SQL をここに分ける（metrics.md §4）。なければ db
  sessionDb?: TestDb;
  metrics?: PromMetrics;
  controllers?: Controller[];
  photoFiles?: PhotoFiles;
  clock?: Clock;
  keys?: SessionKeySource;
};

// API テスト用に、server.ts と同じ組み立て（AppAssembly）をする。db を渡さなければ DB を使わない（FakeDatabase）
// photoFiles を渡さなければファイルを書かない（FakePhotoFiles）。Cookie は手元と同じ ol_session（Secure なし）
export class TestApp implements HttpApp {
  readonly #assembly: AppAssembly;
  readonly #logger = new FakeLogger();

  constructor(options: TestAppOptions = {}) {
    const { db = new FakeDatabase(), sessionDb, metrics = new PromMetrics(), controllers, photoFiles, clock, keys } = options;
    this.#assembly = new AppAssembly({
      db,
      sessionDb,
      metrics,
      photoFiles: photoFiles ?? new FakePhotoFiles(),
      clock: clock ?? new SystemClock(),
      keys: keys ?? new RandomSessionKeys(),
      ipHashSecret: "test-secret",
      secureCookie: false,
      logger: this.#logger,
      extraControllers: controllers,
    });
  }

  build(): Express {
    return this.#app().build();
  }

  listen(port: number): Promise<Server> {
    return this.#app().listen(port);
  }

  // 登録されるルートを router に登録する（分離テストがルートの一覧を集める。testing.md §7）
  routes(router: Routes): void {
    this.#app().routes(router);
  }

  #app(): ExpressApp {
    return this.#assembly.app();
  }

  loggedErrors(): unknown[] {
    return this.#logger.errors();
  }
}
