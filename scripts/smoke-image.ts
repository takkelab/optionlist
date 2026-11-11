// npm run smoke:image -- <イメージ>。本番用のイメージを起動して確かめる（testing.md §6 の 8。docs/decisions/0054）
// APP_ENV=production で起動し、テスト用 DB（APP_DATABASE_URL。手元は backend/.env.test）につなぐ
// 1 回目は PUBLIC_INDEXING なし（noindex が付く）、2 回目は PUBLIC_INDEXING=true（付かない）
import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { ContainerDatabaseUrl, FetchHttpGetter, ImageSmokeChecks } from "./lib/image-smoke.ts";

const image = process.argv[2];
const appDatabaseUrl = process.env.APP_DATABASE_URL ?? "";
const cleanupDatabaseUrl = process.env.CLEANUP_DATABASE_URL ?? "";
if (image === undefined || appDatabaseUrl === "" || cleanupDatabaseUrl === "" || (process.env.DATABASE_URL ?? "") === "") {
  console.error("使い方: npm run smoke:image -- <イメージ>（APP_DATABASE_URL・DATABASE_URL・CLEANUP_DATABASE_URL が要る。手元は backend/.env.test から読む）");
  process.exit(1);
}

const docker = (args: string[]) => spawnSync("docker", args, { encoding: "utf8" });

// 空いているポートを OS に選ばせる（2 回の起動で同じものを使う。1 回目のコンテナは消してから起動し直す）
const freePort = await new Promise<number>((resolve, reject) => {
  const server = createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    server.close(() => (typeof address === "object" && address !== null ? resolve(address.port) : reject(new Error("ポートを選べなかった"))));
  });
});

// 起動するまでは接続を断られるので、最後の失敗だけを覚えておき、待ちきれなかったときに出す
const waitForHealth = async (base: string, name: string): Promise<boolean> => {
  let lastFailure = "まだ聞いていない";
  for (let i = 0; i < 60; i++) {
    const running = docker(["inspect", "-f", "{{.State.Running}}", name]);
    if (running.stdout.trim() !== "true") {
      console.error("コンテナが止まった");
      return false;
    }
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) return true;
      lastFailure = `HTTP ${res.status}`;
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  console.error(`/api/health の最後の失敗: ${lastFailure}`);
  return false;
};

const runOnce = async (label: string, extraEnv: string[], check: (checks: ImageSmokeChecks) => Promise<string[]>): Promise<boolean> => {
  const port = freePort;
  const origin = `http://localhost:${port}`;
  const name = `optionlist-smoke-${process.pid}`;
  const env = [
    "APP_ENV=production",
    `APP_ORIGIN=${origin}`,
    `APP_DATABASE_URL=${new ContainerDatabaseUrl().rewrite(appDatabaseUrl)}`,
    "METRICS_TOKEN=smoke-metrics-token",
    "IP_HASH_SECRET=smoke-ip-hash-secret",
    // 写真は触らない。起動に要るので名前だけ渡す（Cloud Storage にはつながない）
    "PHOTO_BUCKET=optionlist-smoke-unused",
    ...extraEnv,
  ];
  const run = docker(["run", "-d", "--name", name, "-p", `${port}:8080`, "--add-host=host.docker.internal:host-gateway", ...env.flatMap((e) => ["-e", e]), image]);
  if (run.status !== 0) {
    console.error(`❌ ${label}: docker run に失敗した\n${run.stderr}`);
    return false;
  }
  try {
    const problems = (await waitForHealth(origin, name)) ? await check(new ImageSmokeChecks(new FetchHttpGetter(origin))) : ["/api/health が 60 秒で 200 にならなかった"];
    for (const problem of problems) console.error(`❌ ${label}: ${problem}`);
    if (problems.length === 0) console.log(`✅ ${label}`);
    else {
      const logs = docker(["logs", name]);
      console.error(`${logs.stdout}${logs.stderr}`);
    }
    return problems.length === 0;
  } finally {
    docker(["rm", "-f", name]);
  }
};

// マイグレーションの Cloud Run Job と同じコマンドを、イメージの中の dbmate で流す（docs/decisions/0057）
// テスト用 DB は最新までマイグレーション済みなので、何もせずに成功する。版とマイグレーションのファイルがイメージに入っていることを確かめる
const migrateOnce = (): boolean => {
  const migratorUrl = process.env.DATABASE_URL ?? "";
  const run = docker([
    "run", "--rm", "--add-host=host.docker.internal:host-gateway",
    "-e", `DATABASE_URL=${new ContainerDatabaseUrl().rewrite(migratorUrl)}`,
    image, "dbmate", "--no-dump-schema", "--migrations-dir", "db/migrations", "migrate",
  ]);
  if (run.status === 0) console.log("✅ dbmate migrate（マイグレーションの Job のコマンド）");
  else console.error(`❌ dbmate migrate が終了コード ${run.status} で終わった\n${run.stdout}${run.stderr}`);
  return run.status === 0;
};

// 削除のジョブの Cloud Run Job と同じコマンドを流す（data.md §5）。jobs/ がイメージに入り、ol_cleanup でつないで最後まで流れることを確かめる
// PHOTO_BUCKET は渡さない（Cloud Storage にはつながない。写真はイメージの中の空のフォルダを見る）。テスト用 DB の期限切れの行は消えてよい
const cleanupOnce = (): boolean => {
  const run = docker([
    "run", "--rm", "--add-host=host.docker.internal:host-gateway",
    "-e", `CLEANUP_DATABASE_URL=${new ContainerDatabaseUrl().rewrite(cleanupDatabaseUrl)}`,
    image, "node", "--import", "tsx", "--max-semi-space-size=4", "src/jobs/cleanup.ts",
  ]);
  const ok = run.status === 0 && run.stdout.includes('"kind":"cleanup_result"');
  if (ok) console.log("✅ 削除のジョブ（cleanup の Job のコマンド）");
  else console.error(`❌ 削除のジョブが終了コード ${run.status} で終わった（または cleanup_result を出さなかった）\n${run.stdout}${run.stderr}`);
  return ok;
};

const migrated = migrateOnce();
const cleaned = cleanupOnce();
const hidden = await runOnce("PUBLIC_INDEXING なし", [], (checks) => checks.hidden());
const indexed = await runOnce("PUBLIC_INDEXING=true", ["PUBLIC_INDEXING=true"], (checks) => checks.indexed());
process.exit(migrated && cleaned && hidden && indexed ? 0 : 1);
