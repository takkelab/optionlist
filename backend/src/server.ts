import { ExpressApp } from "./app";
import { AchievementPhotoController } from "./controllers/AchievementPhotoController";
import { AchievementsController } from "./controllers/AchievementsController";
import { EventInput } from "./controllers/EventInput";
import { EventsController } from "./controllers/EventsController";
import { HealthController } from "./controllers/HealthController";
import { MetricsController } from "./controllers/MetricsController";
import { OptionInput } from "./controllers/OptionInput";
import { OptionsController } from "./controllers/OptionsController";
import { PathId } from "./controllers/PathId";
import { SuggestionsController } from "./controllers/SuggestionsController";
import { LocalPhotoFiles } from "./repositories/LocalPhotoFiles";
import { PgDatabase } from "./infra/PgDatabase";
import { PgPoolFactory } from "./infra/PgPoolFactory";
import { PortGuard, PortInUseError } from "./infra/PortGuard";
import { PromMetrics } from "./metrics/PromMetrics";
import { ErrorHandler } from "./middleware/ErrorHandler";
import { NotFoundHandler } from "./middleware/NotFoundHandler";
import { RequestMetricsRecorder } from "./middleware/RequestMetrics";
import { AchievementRepository } from "./repositories/AchievementRepository";
import { EventRepository } from "./repositories/EventRepository";
import { HealthRepository } from "./repositories/HealthRepository";
import { OptionRepository } from "./repositories/OptionRepository";
import { OptionRowMapper } from "./repositories/OptionRowMapper";
import { SuggestionRepository } from "./repositories/SuggestionRepository";
import { SuggestionRowMapper } from "./repositories/SuggestionRowMapper";
import { AchievementPhotoService } from "./services/AchievementPhotoService";
import { AchievementService } from "./services/AchievementService";
import { SystemClock } from "./services/Clock";
import { EventService } from "./services/EventService";
import { HealthService } from "./services/HealthService";
import { OptionService } from "./services/OptionService";
import { PhotoCleanup } from "./services/PhotoCleanup";
import { PhotoFormat } from "./services/PhotoFormat";
import { SuggestionService } from "./services/SuggestionService";
import { GapSortOrderPlanner } from "./services/SortOrderPlanner";

// エントリーポイント。具体的なクラスを new して注入し（architecture.md §3.1）、ポートを確かめてから listen する
const PORT = Number(process.env.PORT ?? 8000);

const metrics = new PromMetrics();
const db = new PgDatabase(new PgPoolFactory(process.env, console).create(), metrics);
const clock = new SystemClock();
const mapper = new OptionRowMapper();
const photoFiles = new LocalPhotoFiles(process.env.UPLOAD_DIR ?? "uploads");
const photoCleanup = new PhotoCleanup(photoFiles, metrics, console);
const options = new OptionService(new OptionRepository(db, mapper), clock, new GapSortOrderPlanner(), photoCleanup);
const achievementStore = new AchievementRepository(db, mapper);
const achievements = new AchievementService(achievementStore, clock);
const photos = new AchievementPhotoService(achievementStore, photoFiles, photoCleanup, new PhotoFormat());
const ids = new PathId();
const app = new ExpressApp({
  controllers: [
    new HealthController(new HealthService(new HealthRepository(db))),
    new MetricsController(metrics),
    new OptionsController(new OptionInput(ids), options),
    new SuggestionsController(new SuggestionService(new SuggestionRepository(db, new SuggestionRowMapper())), ids),
    new AchievementsController(new OptionInput(ids), achievements),
    new AchievementPhotoController(ids, photos, photoFiles.directory()),
    new EventsController(new EventInput(), new EventService(new EventRepository(db), clock)),
  ],
  requestMetrics: new RequestMetricsRecorder(metrics),
  notFound: new NotFoundHandler(),
  errorHandler: new ErrorHandler(metrics, console),
});
const portGuard = new PortGuard(500);

try {
  await portGuard.ensureFree(PORT);
  await app.listen(PORT);
  console.log(`server running at: http://localhost:${PORT}`);
} catch (error) {
  const addressInUse = error instanceof PortInUseError || (error instanceof Error && "code" in error && error.code === "EADDRINUSE");
  console.error(addressInUse ? portGuard.message(PORT) : error);
  process.exit(1);
}
