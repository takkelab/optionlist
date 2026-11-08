import { AppAssembly } from "./AppAssembly";
import { LocalPhotoFiles } from "./repositories/LocalPhotoFiles";
import { PgDatabase } from "./infra/PgDatabase";
import { PgPoolFactory } from "./infra/PgPoolFactory";
import { PortGuard, PortInUseError } from "./infra/PortGuard";
import { PromMetrics } from "./metrics/PromMetrics";
import { RandomSessionKeys } from "./services/AccountService";
import { SystemClock } from "./services/Clock";

// エントリーポイント。具体的なクラスを new して注入し（architecture.md §3.1）、ポートを確かめてから listen する
// controller などの組み立ては AppAssembly（テストの TestApp も同じものを使う）
const PORT = Number(process.env.PORT ?? 8000);

const metrics = new PromMetrics();
const app = new AppAssembly({
  // アプリは ol_app で接続する（RLS を受ける。data.md §4）
  db: new PgDatabase(new PgPoolFactory(process.env, console, "APP_DATABASE_URL").create(), metrics),
  metrics,
  photoFiles: new LocalPhotoFiles(process.env.UPLOAD_DIR ?? "uploads"),
  clock: new SystemClock(),
  keys: new RandomSessionKeys(),
  ipHashSecret: process.env.IP_HASH_SECRET ?? "",
  // 確認用・本番（https）だけ Secure を付け、名前を __Host-ol_session にする（api.md §6、architecture.md §4.3）
  secureCookie: ["staging", "production"].includes(process.env.APP_ENV ?? ""),
  logger: console,
}).app();
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
