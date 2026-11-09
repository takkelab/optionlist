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
import { AppEnvRules } from "./infra/AppConfig";
import type { AppEnv } from "./infra/AppConfig";
import type { Database, UserScopes } from "./infra/PgDatabase";
import { ApiNoStore, ApiRequests, JsonContentType, OriginGuard } from "./middleware/ApiGuards";
import { WriteRateLimit } from "./middleware/WriteRateLimit";
import { MemoryRateLimiter } from "./services/RateLimiter";
import type { RateLimit } from "./services/RateLimiter";
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
import type { PhotoFiles } from "./repositories/PhotoFiles";
import { OptionRepository } from "./repositories/OptionRepository";
import { OptionRowMapper } from "./repositories/OptionRowMapper";
import { SuggestionRepository } from "./repositories/SuggestionRepository";
import { SuggestionRowMapper } from "./repositories/SuggestionRowMapper";
import { UserRepository } from "./repositories/UserRepository";
import { AccountHasher } from "./services/AccountHasher";
import { AccountService } from "./services/AccountService";
import type { SessionKeySource } from "./services/AccountService";
import { AccountSettingsService } from "./services/AccountSettingsService";
import { AchievementPhotoService, DEFAULT_PHOTO_QUOTA } from "./services/AchievementPhotoService";
import type { PhotoQuota } from "./services/AchievementPhotoService";
import { SharpPhotoRebuilder } from "./services/PhotoRebuilder";
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
  // 確認用・本番では Cookie に Secure を付けて名前を __Host-ol_session にし（api.md §6）、/api/health/db の message を隠す（api.md §2）
  appEnv: AppEnv;
  // Origin の確認に使う自分のオリジン。null なら手元の扱い（リクエストの Host と比べる。api.md §1）
  appOrigin: string | null;
  metricsToken: string;
  // 書き込みの回数の制限（api.md §6）。なければ DEFAULT_RATE_LIMITS。性能テストは同じ人で何百回も書くので緩める
  rateLimits?: RateLimits;
  // 写真の 1 人あたりの上限（data.md §3）。なければ DEFAULT_PHOTO_QUOTA。テストは小さくして 429 を確かめる
  photoQuota?: PhotoQuota;
  logger: Logger;
  // テストだけが足す controller（エラーを投げるルートなど）
  extraControllers?: Controller[];
};

export type RateLimits = { events: RateLimit; writes: RateLimit; photos: RateLimit };

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
// api.md §6 ※仮決め。POST /api/events は 1 つの IP から 1 分に 20 リクエスト、そのほかの書き込みは 1 アカウント 1 分に 120 回
// 写真の保存はそれに加えて 1 アカウント 1 時間に 60 回（docs/decisions/0037）
export const DEFAULT_RATE_LIMITS: RateLimits = {
  events: { limit: 20, windowMs: MINUTE_MS },
  writes: { limit: 120, windowMs: MINUTE_MS },
  photos: { limit: 60, windowMs: HOUR_MS },
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
  readonly #deployed: boolean;
  readonly #appOrigin: string | null;
  readonly #metricsToken: string;
  readonly #rateLimits: RateLimits;
  readonly #photoQuota: PhotoQuota;
  readonly #logger: Logger;
  readonly #extraControllers: Controller[];

  constructor(deps: AssemblyDeps) {
    const { db, sessionDb, metrics, photoFiles, clock, keys, ipHashSecret, logger, extraControllers } = deps;
    this.#db = db;
    this.#sessionDb = sessionDb ?? db;
    this.#metrics = metrics;
    this.#photoFiles = photoFiles;
    this.#clock = clock;
    this.#keys = keys;
    this.#ipHashSecret = ipHashSecret;
    this.#deployed = new AppEnvRules().isDeployed(deps.appEnv);
    this.#appOrigin = deps.appOrigin;
    this.#metricsToken = deps.metricsToken;
    this.#rateLimits = deps.rateLimits ?? DEFAULT_RATE_LIMITS;
    this.#photoQuota = deps.photoQuota ?? DEFAULT_PHOTO_QUOTA;
    this.#logger = logger;
    this.#extraControllers = extraControllers ?? [];
  }

  app(): ExpressApp {
    const user = new SessionLocals();
    const cookie = new SessionCookie(this.#deployed);
    const requests = new ApiRequests();
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
      guards: [new ApiNoStore(), new OriginGuard(this.#appOrigin, requests), new JsonContentType(requests)],
      session: new SessionMiddleware(accounts, cookie, user),
      rateLimit: this.#rateLimit(requests, user),
      notFound: new NotFoundHandler(),
      errorHandler: new ErrorHandler(this.#metrics, this.#logger),
    });
  }

  #rateLimit(requests: ApiRequests, user: SessionLocals): WriteRateLimit {
    const { events, writes, photos } = this.#rateLimits;
    const limiters = {
      events: new MemoryRateLimiter(events, this.#clock),
      writes: new MemoryRateLimiter(writes, this.#clock),
      photos: new MemoryRateLimiter(photos, this.#clock),
    };
    return new WriteRateLimit(limiters, requests, user);
  }

  #controllers(user: SessionLocals, cookie: SessionCookie, accounts: AccountService): Controller[] {
    const mapper = new OptionRowMapper();
    const cleanup = new PhotoCleanup(this.#photoFiles, this.#metrics, this.#logger);
    const options = new OptionService(new OptionRepository(this.#db, mapper), this.#clock, new GapSortOrderPlanner(), cleanup);
    const achievementStore = new AchievementRepository(this.#db, mapper);
    const photos = new AchievementPhotoService({
      stores: achievementStore,
      files: this.#photoFiles,
      cleanup,
      format: new PhotoFormat(),
      rebuilder: new SharpPhotoRebuilder(),
      quota: this.#photoQuota,
    });
    const ids = new PathId();
    return [
      new HealthController(new HealthService(new HealthRepository(this.#db)), !this.#deployed),
      new MetricsController(this.#metrics, this.#metricsToken),
      new OptionsController({ input: new OptionInput(ids), options, user, accounts, cookie }),
      new SuggestionsController(new SuggestionService(new SuggestionRepository(this.#db, new SuggestionRowMapper())), ids, user),
      new AchievementsController(new OptionInput(ids), new AchievementService(achievementStore, this.#clock), user),
      new AchievementPhotoController(ids, photos, user),
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
