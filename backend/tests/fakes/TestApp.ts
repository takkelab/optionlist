import type { Express } from "express";
import type { Server } from "node:http";
import { ExpressApp } from "../../src/app";
import { AchievementPhotoController } from "../../src/controllers/AchievementPhotoController";
import { AchievementsController } from "../../src/controllers/AchievementsController";
import type { HttpApp } from "../../src/app";
import { EventInput } from "../../src/controllers/EventInput";
import { EventsController } from "../../src/controllers/EventsController";
import { HealthController } from "../../src/controllers/HealthController";
import type { Controller } from "../../src/controllers/http";
import { MetricsController } from "../../src/controllers/MetricsController";
import { OptionInput } from "../../src/controllers/OptionInput";
import { OptionsController } from "../../src/controllers/OptionsController";
import { PathId } from "../../src/controllers/PathId";
import { SuggestionsController } from "../../src/controllers/SuggestionsController";
import type { Database } from "../../src/infra/PgDatabase";
import { PromMetrics } from "../../src/metrics/PromMetrics";
import { ErrorHandler } from "../../src/middleware/ErrorHandler";
import { NotFoundHandler } from "../../src/middleware/NotFoundHandler";
import { RequestMetricsRecorder } from "../../src/middleware/RequestMetrics";
import { AchievementRepository } from "../../src/repositories/AchievementRepository";
import { EventRepository } from "../../src/repositories/EventRepository";
import { HealthRepository } from "../../src/repositories/HealthRepository";
import { OptionRepository } from "../../src/repositories/OptionRepository";
import { OptionRowMapper } from "../../src/repositories/OptionRowMapper";
import { SuggestionRepository } from "../../src/repositories/SuggestionRepository";
import { SuggestionRowMapper } from "../../src/repositories/SuggestionRowMapper";
import { AchievementPhotoService } from "../../src/services/AchievementPhotoService";
import { AchievementService } from "../../src/services/AchievementService";
import type { PhotoFiles } from "../../src/repositories/LocalPhotoFiles";
import { PhotoCleanup } from "../../src/services/PhotoCleanup";
import { PhotoFormat } from "../../src/services/PhotoFormat";
import { SystemClock } from "../../src/services/Clock";
import { EventService } from "../../src/services/EventService";
import { HealthService } from "../../src/services/HealthService";
import { OptionService } from "../../src/services/OptionService";
import { SuggestionService } from "../../src/services/SuggestionService";
import { GapSortOrderPlanner } from "../../src/services/SortOrderPlanner";
import { FakeDatabase } from "./FakeDatabase";
import { FakeLogger } from "./FakeLogger";
import { FakePhotoFiles } from "./FakePhotoFiles";

export type TestAppOptions = { db?: Database; metrics?: PromMetrics; controllers?: Controller[]; photoFiles?: PhotoFiles };

// API テスト用に server.ts と同じ組み立てをする。db を渡さなければ DB を使わない（FakeDatabase）
// photoFiles を渡さなければファイルを書かない（FakePhotoFiles）
export class TestApp implements HttpApp {
  readonly #db: Database;
  readonly #metrics: PromMetrics;
  readonly #controllers: Controller[];
  readonly #photoFiles: PhotoFiles;
  readonly #logger = new FakeLogger();

  constructor(options: TestAppOptions = {}) {
    this.#db = options.db ?? new FakeDatabase();
    this.#metrics = options.metrics ?? new PromMetrics();
    this.#controllers = options.controllers ?? [];
    this.#photoFiles = options.photoFiles ?? new FakePhotoFiles();
  }

  build(): Express {
    return this.#app().build();
  }

  listen(port: number): Promise<Server> {
    return this.#app().listen(port);
  }

  #app(): ExpressApp {
    const health = new HealthController(new HealthService(new HealthRepository(this.#db)));
    const mapper = new OptionRowMapper();
    const optionStore = new OptionRepository(this.#db, mapper);
    const clock = new SystemClock();
    const cleanup = new PhotoCleanup(this.#photoFiles, this.#metrics, this.#logger);
    const optionService = new OptionService(optionStore, clock, new GapSortOrderPlanner(), cleanup);
    const achievementStore = new AchievementRepository(this.#db, mapper);
    const achievementService = new AchievementService(achievementStore, clock);
    const photos = new AchievementPhotoService(achievementStore, this.#photoFiles, cleanup, new PhotoFormat());
    const ids = new PathId();
    return new ExpressApp({
      controllers: [
        health,
        new MetricsController(this.#metrics),
        new OptionsController(new OptionInput(ids), optionService),
        new SuggestionsController(new SuggestionService(new SuggestionRepository(this.#db, new SuggestionRowMapper())), ids),
        new AchievementsController(new OptionInput(ids), achievementService),
        new AchievementPhotoController(ids, photos, this.#photoFiles.directory()),
        new EventsController(new EventInput(), new EventService(new EventRepository(this.#db), clock)),
        ...this.#controllers,
      ],
      requestMetrics: new RequestMetricsRecorder(this.#metrics),
      notFound: new NotFoundHandler(),
      errorHandler: new ErrorHandler(this.#metrics, this.#logger),
    });
  }

  loggedErrors(): unknown[] {
    return this.#logger.errors();
  }
}
