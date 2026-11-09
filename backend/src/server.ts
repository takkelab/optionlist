import { AppAssembly } from "./AppAssembly";
import { Storage } from "@google-cloud/storage";
import { GcsPhotoFiles } from "./repositories/GcsPhotoFiles";
import { LocalPhotoFiles } from "./repositories/LocalPhotoFiles";
import { AppEnvRules, EnvAppConfig } from "./infra/AppConfig";
import { JsonLogger, ProcessLineWriter } from "./infra/JsonLogger";
import { PgDatabase } from "./infra/PgDatabase";
import { PgPoolFactory } from "./infra/PgPoolFactory";
import { PortGuard, PortInUseError } from "./infra/PortGuard";
import { PromMetrics } from "./metrics/PromMetrics";
import { RandomSessionKeys } from "./services/AccountService";
import { SystemClock } from "./services/Clock";

// エントリーポイント。具体的なクラスを new して注入し（architecture.md §3.1）、ポートを確かめてから listen する
// controller などの組み立ては AppAssembly（テストの TestApp も同じものを使う）
// ログは 1 行 1 つの JSON（docs/decisions/0042）
const PORT = Number(process.env.PORT ?? 8000);
const logger = new JsonLogger(new ProcessLineWriter());
const portGuard = new PortGuard(500);

try {
  // 確認用・本番で APP_ORIGIN・METRICS_TOKEN・IP_HASH_SECRET がなければ、ここで止まる（docs/decisions/0050）
  const { photoBucket, ...settings } = new EnvAppConfig(process.env, new AppEnvRules()).read();
  const metrics = new PromMetrics();
  // 確認用・本番は Cloud Storage の非公開の入れ物、手元は UPLOAD_DIR（api.md §5）。手元で GCS_EMULATOR_URL があれば fake-gcs-server へつなぐ
  // （STORAGE_EMULATOR_HOST はライブラリが読んで URL がずれるので使わない。docs/decisions/0051）
  const emulator = process.env.GCS_EMULATOR_URL ?? "";
  const storage = new Storage(emulator === "" ? {} : { apiEndpoint: emulator, projectId: "optionlist-local" });
  const photoFiles = photoBucket === null ? new LocalPhotoFiles(process.env.UPLOAD_DIR ?? "uploads") : new GcsPhotoFiles(storage.bucket(photoBucket));
  const app = new AppAssembly({
    // アプリは ol_app で接続する（RLS を受ける。data.md §4）
    db: new PgDatabase(new PgPoolFactory(process.env, logger, "APP_DATABASE_URL").create(), metrics),
    metrics,
    photoFiles,
    clock: new SystemClock(),
    keys: new RandomSessionKeys(),
    ...settings,
    logger,
  }).app();
  await portGuard.ensureFree(PORT);
  await app.listen(PORT);
  logger.info({ kind: "server_started", message: `server running at: http://localhost:${PORT}` });
} catch (error) {
  const addressInUse = error instanceof PortInUseError || (error instanceof Error && "code" in error && error.code === "EADDRINUSE");
  if (addressInUse) logger.error({ kind: "server_start_failed", message: portGuard.message(PORT) });
  else logger.error({ kind: "server_start_failed", message: "起動できなかった", error });
  process.exit(1);
}
