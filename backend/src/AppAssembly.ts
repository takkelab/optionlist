import { ExpressApp } from "./app";
import { AccountController } from "./controllers/AccountController";
import { AccountInput } from "./controllers/AccountInput";
import { AchievementPhotoController } from "./controllers/AchievementPhotoController";
import { AchievementsController } from "./controllers/AchievementsController";
import { EventInput } from "./controllers/EventInput";
import { EventsController } from "./controllers/EventsController";
import { HealthController } from "./controllers/HealthController";
import type { Controller } from "./controllers/http";
import { MetricsController } from "./controllers/MetricsController";
import { OptionInput } from "./controllers/OptionInput";
import { OptionsController } from "./controllers/OptionsController";
import { PathId } from "./controllers/PathId";
import { SuggestionsController } from "./controllers/SuggestionsController";
import type { Database, UserScopes } from "./infra/PgDatabase";
import type { PromMetrics } from "./metrics/PromMetrics";
import { ErrorHandler } from "./middleware/ErrorHandler";
import type { Logger } from "./middleware/Middleware";
import { NotFoundHandler } from "./middleware/NotFoundHandler";
import { RequestMetricsRecorder } from "./middleware/RequestMetrics";
import { SessionCookie } from "./middleware/SessionCookie";
import { SessionLocals } from "./middleware/SessionLocals";
import { SessionMiddleware } from "./middleware/SessionMiddleware";
import { AccountRepository } from "./repositories/AccountRepository";
import { AchievementRepository } from "./repositories/AchievementRepository";
import { EventRepository } from "./repositories/EventRepository";
import { HealthRepository } from "./repositories/HealthRepository";
import type { PhotoFiles } from "./repositories/LocalPhotoFiles";
import { OptionRepository } from "./repositories/OptionRepository";
import { OptionRowMapper } from "./repositories/OptionRowMapper";
import { SuggestionRepository } from "./repositories/SuggestionRepository";
import { SuggestionRowMapper } from "./repositories/SuggestionRowMapper";
import { UserRepository } from "./repositories/UserRepository";
import { AccountHasher } from "./services/AccountHasher";
import { AccountService } from "./services/AccountService";
import type { SessionKeySource } from "./services/AccountService";
import { AccountSettingsService } from "./services/AccountSettingsService";
import { AchievementPhotoService } from "./services/AchievementPhotoService";
import { AchievementService } from "./services/AchievementService";
import type { Clock } from "./services/Clock";
import { EventService } from "./services/EventService";
import { HealthService } from "./services/HealthService";
import { OptionService } from "./services/OptionService";
import { PhotoCleanup } from "./services/PhotoCleanup";
import { PhotoFormat } from "./services/PhotoFormat";
import { CryptoRandomIndex, RecoveryCodes } from "./services/RecoveryCodes";
import { GapSortOrderPlanner } from "./services/SortOrderPlanner";
import { SuggestionService } from "./services/SuggestionService";

export type AssemblyDeps = {
  db: Database & UserScopes;
  // セッションの SQL（auth_find_user など）を流す DB。性能テストは、数えない SQL をここに分ける（metrics.md §4）。なければ db
  sessionDb?: Database & UserScopes;
  metrics: PromMetrics;
  photoFiles: PhotoFiles;
  clock: Clock;
  keys: SessionKeySource;
  ipHashSecret: string;
  // 確認用・本番（https）だけ Secure を付け、名前を __Host-ol_session にする（api.md §6）
  secureCookie: boolean;
  logger: Logger;
  // テストだけが足す controller（エラーを投げるルートなど）
  extraControllers?: Controller[];
};

export interface AppFactory {
  app(): ExpressApp;
}

// アプリの組み立て（architecture.md §3.1）。server.ts とテスト（TestApp）が同じものを使うので、
// 分離テスト（testing.md §7）が集めるルートの一覧は、本番に登録されるルートと必ず同じになる
export class AppAssembly implements AppFactory {
  readonly #db: Database & UserScopes;
  readonly #sessionDb: Database & UserScopes;
  readonly #metrics: PromMetrics;
  readonly #photoFiles: PhotoFiles;
  readonly #clock: Clock;
  readonly #keys: SessionKeySource;
  readonly #ipHashSecret: string;
  readonly #secureCookie: boolean;
  readonly #logger: Logger;
  readonly #extraControllers: Controller[];

  constructor(deps: AssemblyDeps) {
    const { db, sessionDb, metrics, photoFiles, clock, keys, ipHashSecret, secureCookie, logger, extraControllers } = deps;
    this.#db = db;
    this.#sessionDb = sessionDb ?? db;
    this.#metrics = metrics;
    this.#photoFiles = photoFiles;
    this.#clock = clock;
    this.#keys = keys;
    this.#ipHashSecret = ipHashSecret;
    this.#secureCookie = secureCookie;
    this.#logger = logger;
    this.#extraControllers = extraControllers ?? [];
  }

  app(): ExpressApp {
    const user = new SessionLocals();
    const cookie = new SessionCookie(this.#secureCookie);
    const accounts = new AccountService(
      new AccountRepository(this.#sessionDb),
      new UserRepository(this.#sessionDb),
      this.#clock,
      this.#keys,
      this.#ipHashSecret,
    );
    return new ExpressApp({
      controllers: [...this.#controllers(user, cookie, accounts), ...this.#extraControllers],
      requestMetrics: new RequestMetricsRecorder(this.#metrics),
      session: new SessionMiddleware(accounts, cookie, user),
      notFound: new NotFoundHandler(),
      errorHandler: new ErrorHandler(this.#metrics, this.#logger),
    });
  }

  #controllers(user: SessionLocals, cookie: SessionCookie, accounts: AccountService): Controller[] {
    const mapper = new OptionRowMapper();
    const cleanup = new PhotoCleanup(this.#photoFiles, this.#metrics, this.#logger);
    const options = new OptionService(new OptionRepository(this.#db, mapper), this.#clock, new GapSortOrderPlanner(), cleanup);
    const achievementStore = new AchievementRepository(this.#db, mapper);
    const photos = new AchievementPhotoService(achievementStore, this.#photoFiles, cleanup, new PhotoFormat());
    const ids = new PathId();
    return [
      new HealthController(new HealthService(new HealthRepository(this.#db))),
      new MetricsController(this.#metrics),
      new OptionsController({ input: new OptionInput(ids), options, user, accounts, cookie }),
      new SuggestionsController(new SuggestionService(new SuggestionRepository(this.#db, new SuggestionRowMapper())), ids, user),
      new AchievementsController(new OptionInput(ids), new AchievementService(achievementStore, this.#clock), user),
      new AchievementPhotoController(ids, photos, this.#photoFiles.directory(), user),
      new EventsController(new EventInput(), new EventService(new EventRepository(this.#db), this.#clock)),
      new AccountController({ input: new AccountInput(), accounts: this.#accountSettings(cleanup), user, cookie }),
    ];
  }

  // 設定のシートの操作（api.md §6）。復旧コードで移る・すべて消すのは数える SQL なので、セッションの DB ではなく db で流す
  #accountSettings(photos: PhotoCleanup): AccountSettingsService {
    return new AccountSettingsService({
      accounts: new AccountRepository(this.#db),
      users: new UserRepository(this.#db),
      photos,
      keys: this.#keys,
      codes: new RecoveryCodes(new CryptoRandomIndex()),
      hasher: new AccountHasher(this.#ipHashSecret),
      log: this.#logger,
    });
  }
}
