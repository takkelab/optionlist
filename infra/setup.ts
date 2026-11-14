// npm run infra:setup -- <手順> [--dry-run]。確認用・本番の環境を gcloud で作る（process.md §5 の R8・R9。architecture.md §4.1）
// どの手順も何度流しても同じ結果になる（あるものは作らず、設定を決めた値にそろえる）。--dry-run は流すコマンドを表示するだけ
// 手順（この順に流す）:
//   apis                 使う API を有効にする
//   instance             共用の Cloud SQL のインスタンスと、管理用のユーザー（postgres）のパスワード
//   shared               Artifact Registry、GitHub からの Workload Identity Federation、アクセスのログのバケット
//   db <staging|production>   DB とロール（db:roles:cloud を Cloud SQL Auth Proxy 越しに流す）と、接続先の URL の秘密の値
//   domain <staging|production>  独自ドメインのマッピング（Cloud Run）と、DNS に書くレコードの表示（docs/decisions/0063）
//   env <staging|production>  サービスアカウント、写真の入れ物、秘密の値、Cloud Run のサービス・Job、Scheduler、権限、監視（本番は予算も）
// 秘密の値は画面に出さない（Secret Manager には標準入力で渡す）
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ARTIFACT_REPOSITORY, BACKUP, DOMAIN_MAPPINGS_API, PHOTO_SOFT_DELETE_SECONDS, backupLifecycle, backupRunUri, CLEANUP_JOB_ARGS, CLEANUP_JOB_TIMEOUT_SECONDS, CLEANUP_SCHEDULE, ENV_NAMES, GITHUB, INSTANCE, INSTANCE_CONNECTION, LOG_BUCKET, PROJECT_ID,
  PROVIDER_CONDITION, PROVIDER_MAPPING, REGION, SERVICES, cleanupRunUri, deployPrincipal, envConfig, passwordOf, socketDatabaseUrl,
} from "./config.ts";
import type { EnvName } from "./config.ts";
import { CliGcloud, readJson } from "./lib/gcloud.ts";
import type { Gcloud } from "./lib/gcloud.ts";
import { CloudSqlProxy, readSecret } from "./lib/cloud-sql.ts";
import { domainMappingBody, domainMappingUrl, recordLines } from "./domain.ts";
import type { DomainMapping } from "./domain.ts";
import { GoogleApi, billingAccountOf, masked, operatorEmail } from "./lib/google-api.ts";
import {
  BUDGETS_API, BUDGET_DISPLAY_NAME, CLIENT_ERROR_METRIC, LOGGING_API, MONITORING_API, MONITORING_ROOT, alertPolicies, budgetBody, channelBody, clientErrorMetricBody, uptimeBody, uptimeCheckId,
} from "./monitoring.ts";
import type { AlertPolicy, Budget, Channel, LogMetric, UptimeCheck } from "./monitoring.ts";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const [step, envArg] = args.filter((a) => a !== "--dry-run");
const gcloud: Gcloud = new CliGcloud(dryRun);
const P = { project: PROJECT_ID };
const R = { ...P, region: REGION };
const L = { ...P, location: REGION };

const newSecretValue = (): string => randomBytes(32).toString("base64url");
const exists = (cmd: string[], flags: Record<string, string> = P): boolean => gcloud.read(cmd, flags).ok;

const ensureSecret = (name: string, value: () => string): void => {
  if (exists(["secrets", "describe", name])) return;
  // 秘密の値も東京に置く
  gcloud.change(["secrets", "create", name], { ...P, "replication-policy": "user-managed", locations: REGION, "data-file": "-" }, value());
};

const envName = (): EnvName => {
  const found = ENV_NAMES.find((name) => name === envArg);
  if (found === undefined) throw new Error(`${step} のあとに staging か production を書く`);
  return found;
};

const apis = (): void => {
  gcloud.change(["services", "enable", ...SERVICES], P);
};

const instance = (): void => {
  if (!exists(["sql", "instances", "describe", INSTANCE.name])) {
    gcloud.change(["sql", "instances", "create", INSTANCE.name], {
      ...R,
      "database-version": INSTANCE.databaseVersion,
      edition: INSTANCE.edition,
      tier: INSTANCE.tier,
      "availability-type": "zonal",
      "storage-type": "SSD",
      "storage-size": `${INSTANCE.storageGb}GB`,
      "storage-auto-increase": true,
      "backup-start-time": INSTANCE.backupStartTime,
      "enable-point-in-time-recovery": true,
      "retained-backups-count": INSTANCE.retainedBackups,
      "retained-transaction-log-days": INSTANCE.transactionLogDays,
      "deletion-protection": true,
      "retain-backups-on-delete": true,
      "backup-location": INSTANCE.backupLocation,
      // Cloud SQL Auth Proxy・Cloud Run のコネクタ（どちらも TLS）からだけつなぐ。承認済みのネットワークは足さない
      "ssl-mode": "ENCRYPTED_ONLY",
    });
  }
  // 前からあるインスタンスも、バックアップの置き場所を東京にそろえる（違うときだけ変える。docs/decisions/0061）
  const current = readJson<{ settings?: { backupConfiguration?: { location?: string } } }>(gcloud, ["sql", "instances", "describe", INSTANCE.name], P);
  if (current?.settings?.backupConfiguration?.location !== INSTANCE.backupLocation) {
    gcloud.change(["sql", "instances", "patch", INSTANCE.name], { ...P, "backup-location": INSTANCE.backupLocation });
  }
  if (!exists(["secrets", "describe", INSTANCE.adminPasswordSecret])) {
    const password = newSecretValue();
    ensureSecret(INSTANCE.adminPasswordSecret, () => password);
    // --password は flags-file（一時ファイル。すぐ消す）で渡り、コマンドラインと画面には出ない
    gcloud.change(["sql", "users", "set-password", "postgres"], { ...P, instance: INSTANCE.name, password });
  }
};

const shared = (): void => {
  if (!exists(["artifacts", "repositories", "describe", ARTIFACT_REPOSITORY], { ...P, location: REGION })) {
    gcloud.change(["artifacts", "repositories", "create", ARTIFACT_REPOSITORY], { ...P, location: REGION, "repository-format": "docker" });
  }
  if (!exists(["iam", "workload-identity-pools", "describe", GITHUB.pool], { ...P, location: "global" })) {
    gcloud.change(["iam", "workload-identity-pools", "create", GITHUB.pool], { ...P, location: "global", "display-name": "GitHub Actions" });
  }
  const provider = { ...P, location: "global", "workload-identity-pool": GITHUB.pool };
  const oidc = { ...provider, "attribute-mapping": PROVIDER_MAPPING, "attribute-condition": PROVIDER_CONDITION };
  if (exists(["iam", "workload-identity-pools", "providers", "describe", GITHUB.provider], provider)) {
    gcloud.change(["iam", "workload-identity-pools", "providers", "update-oidc", GITHUB.provider], oidc);
  } else {
    gcloud.change(["iam", "workload-identity-pools", "providers", "create-oidc", GITHUB.provider], { ...oidc, "issuer-uri": "https://token.actions.githubusercontent.com" });
  }
  // アクセスのログ（Cloud Run のリクエストのログ）を東京のバケットに置く（docs/decisions/0057）
  if (!exists(["logging", "buckets", "describe", LOG_BUCKET.name], { ...P, location: REGION })) {
    gcloud.change(["logging", "buckets", "create", LOG_BUCKET.name], { ...P, location: REGION, "retention-days": LOG_BUCKET.retentionDays });
  }
  gcloud.change(["logging", "sinks", "update", "_Default", `logging.googleapis.com/projects/${PROJECT_ID}/locations/${REGION}/buckets/${LOG_BUCKET.name}`], P);
};

const db = async (env: EnvName): Promise<void> => {
  const c = envConfig(env);
  // パスワードは接続先の URL（Cloud Run から読む Unix ソケットの形）ごと Secret Manager に置く。2 回目からはそこから読む
  ensureSecret(c.secrets.databaseUrl, () => socketDatabaseUrl(c.roles.migrator, newSecretValue(), c.database));
  ensureSecret(c.secrets.appDatabaseUrl, () => socketDatabaseUrl(c.roles.app, newSecretValue(), c.database));
  ensureSecret(c.secrets.cleanupDatabaseUrl, () => socketDatabaseUrl(c.roles.cleanup, newSecretValue(), c.database));
  // 利用状況（metrics.md §6）。手元から Proxy 越しに読むだけだが、ほかと同じ形で置き、パスワードだけを取り出して使う
  ensureSecret(c.secrets.metricsDatabaseUrl, () => socketDatabaseUrl(c.roles.metrics, newSecretValue(), c.database));
  if (dryRun) {
    console.log(`▶ Cloud SQL Auth Proxy を起動し、npm --prefix backend run db:roles:cloud -- --env ${env}`);
    return;
  }
  const proxy = await CloudSqlProxy.start();
  try {
    const admin = readSecret(gcloud, INSTANCE.adminPasswordSecret);
    const migrator = passwordOf(readSecret(gcloud, c.secrets.databaseUrl));
    const app = passwordOf(readSecret(gcloud, c.secrets.appDatabaseUrl));
    const cleanup = passwordOf(readSecret(gcloud, c.secrets.cleanupDatabaseUrl));
    const metrics = passwordOf(readSecret(gcloud, c.secrets.metricsDatabaseUrl));
    console.log(`▶ npm --prefix backend run db:roles:cloud -- --env ${env}（Proxy 越し）`);
    // 接続先はすべて下で渡す。手元のシェルに残った値は、下で上書きされる
    const result = spawnSync(`npm --prefix backend run -s db:roles:cloud -- --env ${env}`, {
      shell: true,
      stdio: "inherit",
      env: {
        ...process.env,
        ADMIN_DATABASE_URL: proxy.url("postgres", admin, "postgres"),
        DATABASE_URL: proxy.url(c.roles.migrator, migrator, c.database),
        APP_DATABASE_URL: proxy.url(c.roles.app, app, c.database),
        CLEANUP_DATABASE_URL: proxy.url(c.roles.cleanup, cleanup, c.database),
        METRICS_DATABASE_URL: proxy.url(c.roles.metrics, metrics, c.database),
      },
    });
    if (result.status !== 0) throw new Error("db:roles:cloud が失敗した");
  } finally {
    proxy.stop();
  }
};

const env = (name: EnvName): void => {
  const c = envConfig(name);
  for (const [key, email] of Object.entries(c.serviceAccounts)) {
    const id = email.split("@")[0] ?? "";
    if (!exists(["iam", "service-accounts", "describe", email])) {
      gcloud.change(["iam", "service-accounts", "create", id], { ...P, "display-name": `optionlist ${name} ${key}` });
    }
  }
  const { run, migrate, cleanup, scheduler, deploy } = c.serviceAccounts;
  // Cloud SQL へつなぐ権限（インスタンスの単位では付けられない。DB に入れるかはロールのパスワードで分ける。docs/decisions/0056）
  for (const member of [run, migrate, cleanup]) {
    gcloud.change(["projects", "add-iam-policy-binding", PROJECT_ID], { member: `serviceAccount:${member}`, role: "roles/cloudsql.client", condition: "None" });
  }

  // 写真の入れ物（非公開。docs/decisions/0037）
  if (!exists(["storage", "buckets", "describe", `gs://${c.bucket}`])) {
    gcloud.change(["storage", "buckets", "create", `gs://${c.bucket}`], { ...P, location: REGION, "uniform-bucket-level-access": true, "public-access-prevention": true });
  }
  for (const member of [run, cleanup]) {
    gcloud.change(["storage", "buckets", "add-iam-policy-binding", `gs://${c.bucket}`], { member: `serviceAccount:${member}`, role: "roles/storage.objectAdmin" });
  }
  // 消した写真を 7 日間戻せるようにする（data.md §6）
  gcloud.change(["storage", "buckets", "update", `gs://${c.bucket}`], { "soft-delete-duration": `${PHOTO_SOFT_DELETE_SECONDS}s` });

  ensureSecret(c.secrets.metricsToken, newSecretValue);
  ensureSecret(c.secrets.ipHashSecret, newSecretValue);
  for (const secret of [c.secrets.appDatabaseUrl, c.secrets.metricsToken, c.secrets.ipHashSecret]) {
    gcloud.change(["secrets", "add-iam-policy-binding", secret], { ...P, member: `serviceAccount:${run}`, role: "roles/secretmanager.secretAccessor" });
  }
  gcloud.change(["secrets", "add-iam-policy-binding", c.secrets.databaseUrl], { ...P, member: `serviceAccount:${migrate}`, role: "roles/secretmanager.secretAccessor" });
  gcloud.change(["secrets", "add-iam-policy-binding", c.secrets.cleanupDatabaseUrl], { ...P, member: `serviceAccount:${cleanup}`, role: "roles/secretmanager.secretAccessor" });

  // サービスと Job は、最初は Google のサンプルのイメージで作る。イメージは deploy.yml が差し替える（設定はここで決める）
  const serviceFlags = {
    ...R,
    "service-account": run,
    // 台数はサービスの単位（--min・--max）とリビジョンの単位（--min-instances・--max-instances）の両方にある。どちらも決めた値にそろえる
    min: 0,
    max: c.maxInstances,
    "min-instances": 0,
    "max-instances": c.maxInstances,
    "cpu-boost": true,
    cpu: 1,
    memory: "512Mi",
    port: 8080,
    "add-cloudsql-instances": INSTANCE_CONNECTION,
    "update-env-vars": `APP_ENV=${name},APP_ORIGIN=${c.origin},PHOTO_BUCKET=${c.bucket}`,
    "update-secrets": `APP_DATABASE_URL=${c.secrets.appDatabaseUrl}:latest,METRICS_TOKEN=${c.secrets.metricsToken}:latest,IP_HASH_SECRET=${c.secrets.ipHashSecret}:latest`,
  };
  if (exists(["run", "services", "describe", c.service], R)) gcloud.change(["run", "services", "update", c.service], serviceFlags);
  else gcloud.change(["run", "deploy", c.service], { ...serviceFlags, image: "us-docker.pkg.dev/cloudrun/container/hello", "allow-unauthenticated": true });

  const jobFlags = {
    ...R,
    "service-account": migrate,
    "set-cloudsql-instances": INSTANCE_CONNECTION,
    "update-secrets": `DATABASE_URL=${c.secrets.databaseUrl}:latest`,
    command: "dbmate",
    args: "--no-dump-schema,--migrations-dir,db/migrations,migrate",
    "max-retries": 0,
    "task-timeout": "10m",
  };
  if (exists(["run", "jobs", "describe", c.migrateJob], R)) gcloud.change(["run", "jobs", "update", c.migrateJob], jobFlags);
  else gcloud.change(["run", "jobs", "create", c.migrateJob], { ...jobFlags, image: "us-docker.pkg.dev/cloudrun/container/job:latest" });

  // 削除のジョブ（data.md §5）。ol_cleanup_<env> でつなぎ、写真の入れ物を見る。失敗しても自動で流し直さない（次の日に流れる）
  const cleanupJobFlags = {
    ...R,
    "service-account": cleanup,
    "set-cloudsql-instances": INSTANCE_CONNECTION,
    "update-secrets": `CLEANUP_DATABASE_URL=${c.secrets.cleanupDatabaseUrl}:latest`,
    "update-env-vars": `APP_ENV=${name},PHOTO_BUCKET=${c.bucket}`,
    command: "node",
    args: CLEANUP_JOB_ARGS.join(","),
    "max-retries": 0,
    "task-timeout": `${CLEANUP_JOB_TIMEOUT_SECONDS}s`,
  };
  if (exists(["run", "jobs", "describe", c.cleanupJob], R)) gcloud.change(["run", "jobs", "update", c.cleanupJob], cleanupJobFlags);
  else gcloud.change(["run", "jobs", "create", c.cleanupJob], { ...cleanupJobFlags, image: "us-docker.pkg.dev/cloudrun/container/job:latest" });

  // Cloud Scheduler が毎日 4 時（日本時間）に、Cloud Run の API で削除のジョブを起動する。名乗るのは Job の run.invoker だけを持つサービスアカウント
  const schedulerFlags = {
    ...L,
    schedule: CLEANUP_SCHEDULE.cron,
    "time-zone": CLEANUP_SCHEDULE.timeZone,
    uri: cleanupRunUri(c),
    "http-method": "POST",
    "oauth-service-account-email": scheduler,
  };
  if (exists(["scheduler", "jobs", "describe", c.cleanupScheduler], L)) gcloud.change(["scheduler", "jobs", "update", "http", c.cleanupScheduler], schedulerFlags);
  else gcloud.change(["scheduler", "jobs", "create", "http", c.cleanupScheduler], schedulerFlags);

  // デプロイ用のサービスアカウント（docs/decisions/0055）。自分の環境のサービスと Job を変え、実行用のサービスアカウントとして動かせる
  gcloud.change(["run", "services", "add-iam-policy-binding", c.service], { ...R, member: `serviceAccount:${deploy}`, role: "roles/run.developer" });
  gcloud.change(["run", "jobs", "add-iam-policy-binding", c.migrateJob], { ...R, member: `serviceAccount:${deploy}`, role: "roles/run.developer" });
  gcloud.change(["run", "jobs", "add-iam-policy-binding", c.cleanupJob], { ...R, member: `serviceAccount:${deploy}`, role: "roles/run.developer" });
  gcloud.change(["run", "jobs", "add-iam-policy-binding", c.cleanupJob], { ...R, member: `serviceAccount:${scheduler}`, role: "roles/run.invoker" });
  for (const member of [run, migrate, cleanup]) {
    gcloud.change(["iam", "service-accounts", "add-iam-policy-binding", member], { ...P, member: `serviceAccount:${deploy}`, role: "roles/iam.serviceAccountUser" });
  }
  // 確認用は push で作ったイメージを置き、本番は確認用のイメージを読むだけ
  gcloud.change(["artifacts", "repositories", "add-iam-policy-binding", ARTIFACT_REPOSITORY], {
    ...P,
    location: REGION,
    member: `serviceAccount:${deploy}`,
    role: name === "staging" ? "roles/artifactregistry.writer" : "roles/artifactregistry.reader",
  });
  if (name === "production") {
    // 確認用でトラフィックを 100% 受けているリビジョンのイメージを読むため（docs/decisions/0055）
    gcloud.change(["run", "services", "add-iam-policy-binding", envConfig("staging").service], { ...R, member: `serviceAccount:${deploy}`, role: "roles/run.viewer" });
  }
  // GitHub Actions の deploy.yml から、この環境の deploy_target のときだけ入れる
  gcloud.change(["iam", "service-accounts", "add-iam-policy-binding", deploy], { ...P, member: deployPrincipal(name), role: "roles/iam.workloadIdentityUser" });
  if (name === "production") backup();
};

// 週 1 の書き出し（data.md §6。本番だけ）: 入れ物・サービスアカウント・Cloud Run Job・Scheduler・権限
const backup = (): void => {
  const c = envConfig("production");
  const backupSa = BACKUP.serviceAccount;
  if (!exists(["iam", "service-accounts", "describe", backupSa])) {
    gcloud.change(["iam", "service-accounts", "create", backupSa.split("@")[0] ?? ""], { ...P, "display-name": "optionlist production backup" });
  }
  gcloud.change(["projects", "add-iam-policy-binding", PROJECT_ID], { member: `serviceAccount:${backupSa}`, role: "roles/cloudsql.client", condition: "None" });
  gcloud.change(["secrets", "add-iam-policy-binding", BACKUP.databaseUrlSecret], { ...P, member: `serviceAccount:${backupSa}`, role: "roles/secretmanager.secretAccessor" });

  // 入れ物（非公開。35 日で消える）。書き出しのサービスアカウントは作るだけ（読めない・消せない・上書きできない）
  const bucket = `gs://${BACKUP.bucket}`;
  if (!exists(["storage", "buckets", "describe", bucket])) {
    gcloud.change(["storage", "buckets", "create", bucket], { ...P, location: REGION, "uniform-bucket-level-access": true, "public-access-prevention": true });
  }
  const dir = mkdtempSync(join(tmpdir(), "optionlist-lifecycle-"));
  try {
    const lifecycle = join(dir, "lifecycle.json");
    writeFileSync(lifecycle, JSON.stringify(backupLifecycle()));
    // soft delete は外す（既定の 7 日が付くと、35 日で消えたあとも戻せる形で残り、ポリシーの「最長 5 週間」を超える。docs/decisions/0061）
    gcloud.change(["storage", "buckets", "update", bucket], { "lifecycle-file": lifecycle, "clear-soft-delete": true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  gcloud.change(["storage", "buckets", "add-iam-policy-binding", bucket], { member: `serviceAccount:${backupSa}`, role: "roles/storage.objectCreator" });

  const jobFlags = {
    ...R,
    "service-account": backupSa,
    "set-cloudsql-instances": INSTANCE_CONNECTION,
    "update-secrets": `DATABASE_URL=${BACKUP.databaseUrlSecret}:latest`,
    "update-env-vars": `APP_ENV=production,BACKUP_BUCKET=${BACKUP.bucket}`,
    command: "node",
    args: BACKUP.args.join(","),
    "max-retries": 0,
    "task-timeout": `${BACKUP.timeoutSeconds}s`,
  };
  if (exists(["run", "jobs", "describe", BACKUP.job], R)) gcloud.change(["run", "jobs", "update", BACKUP.job], jobFlags);
  else gcloud.change(["run", "jobs", "create", BACKUP.job], { ...jobFlags, image: "us-docker.pkg.dev/cloudrun/container/job:latest" });

  const schedulerFlags = {
    ...L,
    schedule: BACKUP.schedule.cron,
    "time-zone": BACKUP.schedule.timeZone,
    uri: backupRunUri(),
    "http-method": "POST",
    "oauth-service-account-email": c.serviceAccounts.scheduler,
  };
  if (exists(["scheduler", "jobs", "describe", BACKUP.scheduler], L)) gcloud.change(["scheduler", "jobs", "update", "http", BACKUP.scheduler], schedulerFlags);
  else gcloud.change(["scheduler", "jobs", "create", "http", BACKUP.scheduler], schedulerFlags);

  gcloud.change(["run", "jobs", "add-iam-policy-binding", BACKUP.job], { ...R, member: `serviceAccount:${c.serviceAccounts.scheduler}`, role: "roles/run.invoker" });
  // deploy.yml が本番のデプロイでイメージを差し替える
  gcloud.change(["run", "jobs", "add-iam-policy-binding", BACKUP.job], { ...R, member: `serviceAccount:${c.serviceAccounts.deploy}`, role: "roles/run.developer" });
  gcloud.change(["iam", "service-accounts", "add-iam-policy-binding", backupSa], { ...P, member: `serviceAccount:${c.serviceAccounts.deploy}`, role: "roles/iam.serviceAccountUser" });
};

// 監視（metrics.md §8。docs/decisions/0062）: 通知先・死活監視・アラートのポリシー。本番はあわせてログの指標と予算
// どれも表示名で探し、あれば決めた形で置き換え、なければ作る
const monitoring = async (name: EnvName): Promise<void> => {
  const api = new GoogleApi(gcloud, PROJECT_ID, dryRun);
  const byName = async <T extends { displayName?: string }>(url: string, key: string, displayName: string): Promise<T | undefined> => {
    const listed = await api.list<T>(url, key);
    if (listed === null) throw new Error(`${masked(url)} を読めなかった`);
    const found = listed.filter((item) => item.displayName === displayName);
    if (found.length > 1) throw new Error(`表示名が「${displayName}」のものが ${found.length} 個ある（1 つを残して消す）`);
    return found[0];
  };
  const upsert = async <T extends { name?: string; displayName?: string }>(collection: string, key: string, body: T): Promise<string> => {
    const current = await byName<T>(collection, key, body.displayName ?? "");
    if (current?.name !== undefined) {
      await api.change("PATCH", `${MONITORING_ROOT}/${current.name}`, body);
      return current.name;
    }
    const created = await api.change<T>("POST", collection, body);
    // --dry-run では作らないので、名前は仮のもの
    return created?.name ?? "（dry-run）";
  };

  const channel = await upsert<Channel>(`${MONITORING_API}/notificationChannels`, "notificationChannels", channelBody(operatorEmail(gcloud)));
  // 死活監視の host（monitoredResource）は PATCH で変えられず、アラートのポリシーが指している間は消せない。
  // host が変わったら（独自ドメインに移ったときなど）新しく作り、ポリシーを新しい方に付け替えてから古い方を消す。
  // 途中で落ちて同じ表示名が 2 つ残っても、流し直せば決めた host の方を使って続きから進む
  const uptimes = `${MONITORING_API}/uptimeCheckConfigs`;
  const wantUptime = uptimeBody(name);
  const listedUptimes = await api.list<UptimeCheck>(uptimes, "uptimeCheckConfigs");
  if (listedUptimes === null) throw new Error(`${masked(uptimes)} を読めなかった`);
  const sameName = listedUptimes.filter((u) => u.displayName === wantUptime.displayName);
  const isWantedHost = (u: UptimeCheck): boolean => u.monitoredResource?.labels?.host === wantUptime.monitoredResource?.labels?.host;
  const fresh = sameName.filter(isWantedHost);
  const stale = sameName.filter((u) => !isWantedHost(u));
  if (fresh.length > 1) throw new Error(`死活監視「${wantUptime.displayName}」で host が同じものが ${fresh.length} 個ある（アラートのポリシーが指していない方を消す）`);
  let uptime: string;
  if (fresh[0]?.name !== undefined) {
    await api.change("PATCH", `${MONITORING_ROOT}/${fresh[0].name}`, wantUptime);
    uptime = fresh[0].name;
  } else {
    uptime = (await api.change<UptimeCheck>("POST", uptimes, wantUptime))?.name ?? "（dry-run）";
  }

  if (name === "production") {
    // ログの指標は名前で決まる（表示名がない）
    const metricUrl = `${LOGGING_API}/metrics/${CLIENT_ERROR_METRIC}`;
    const metric = await api.get<LogMetric>(metricUrl);
    if (metric.ok) await api.change("PUT", metricUrl, clientErrorMetricBody());
    else await api.change("POST", `${LOGGING_API}/metrics`, clientErrorMetricBody());
  }

  for (const policy of alertPolicies(name, channel, uptimeCheckId(uptime))) {
    await upsert<AlertPolicy>(`${MONITORING_API}/alertPolicies`, "alertPolicies", policy);
  }
  // ポリシーが新しい方を指したので、古い host の方を消せる
  for (const old of stale) if (old.name !== undefined) await api.change("DELETE", `${MONITORING_ROOT}/${old.name}`, undefined);

  if (name === "production") {
    const budgets = `${BUDGETS_API}/${billingAccountOf(gcloud, PROJECT_ID)}/budgets`;
    const current = await byName<Budget>(budgets, "budgets", BUDGET_DISPLAY_NAME);
    // 予算の API は updateMask がないと既定値でない項目しか変えない（既定値に戻せない）ので、決めた項目をすべて名指しする
    // budgetFilter は丸ごとだと 400 になるので、中の項目を名指しする
    const mask = "displayName,budgetFilter.projects,budgetFilter.creditTypesTreatment,budgetFilter.calendarPeriod,amount,thresholdRules,notificationsRule";
    if (current?.name !== undefined) await api.change("PATCH", `${BUDGETS_API}/${current.name}?updateMask=${mask}`, budgetBody(channel));
    else await api.change("POST", budgets, budgetBody(channel));
  }
};

// 独自ドメイン（docs/decisions/0063）: Cloud Run のドメインマッピングを作り、DNS（Cloudflare）に書くレコードを出す。
// 作り直すときの順番: ドメインの所有の確認（gcloud domains verify）→ domain → Cloudflare に DNS（プロキシはオフ）→ 証明書を待つ → env。
// config.ts の origin はもう独自ドメインなので、証明書より前に env を流すと、APP_ORIGIN と死活監視がまだ通らない URL を向く
const domain = async (name: EnvName): Promise<void> => {
  const api = new GoogleApi(gcloud, PROJECT_ID, dryRun);
  const current = await api.get<DomainMapping>(domainMappingUrl(name));
  if (current.ok) {
    const route = current.body.spec?.routeName;
    // 別のサービスを指しているなら、黙って付け替えない（手で消してから流し直す）
    if (route !== envConfig(name).service) throw new Error(`${envConfig(name).domain} のマッピングが ${route ?? "（なし）"} を指している（${envConfig(name).service} にする）`);
  } else if (current.status === 404) {
    await api.change("POST", DOMAIN_MAPPINGS_API, domainMappingBody(name));
  } else {
    throw new Error(`${envConfig(name).domain} のマッピングを読めなかった（${current.status}）: ${current.message}`);
  }
  if (dryRun) return;
  // レコードは作った直後には出ないことがあるので、少し待って読み直す
  for (let i = 0; i < 10; i++) {
    const mapping = await api.get<DomainMapping>(domainMappingUrl(name));
    const lines = mapping.ok ? recordLines(mapping.body) : [];
    if (lines.length > 0) {
      console.log(`Cloudflare に書くレコード（プロキシはオフ〈DNS only〉にする）:\n${lines.join("\n")}`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  console.log("レコードがまだ出ていない。少し待って、もう一度流す");
};

try {
  if (step === "apis") apis();
  else if (step === "instance") instance();
  else if (step === "shared") shared();
  else if (step === "db") await db(envName());
  else if (step === "domain") await domain(envName());
  else if (step === "env") {
    env(envName());
    await monitoring(envName());
  }
  else throw new Error("使い方: npm run infra:setup -- <apis|instance|shared|db <env>|domain <env>|env <env>> [--dry-run]");
  console.log(dryRun ? "（--dry-run。何も変えていない）" : `✅ ${step}${envArg === undefined ? "" : ` ${envArg}`}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
