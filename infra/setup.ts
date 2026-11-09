// npm run infra:setup -- <手順> [--dry-run]。確認用・本番の環境を gcloud で作る（process.md §5 の R8。architecture.md §4.1）
// どの手順も何度流しても同じ結果になる（あるものは作らず、設定を決めた値にそろえる）。--dry-run は流すコマンドを表示するだけ
// 手順（この順に流す）:
//   apis                 使う API を有効にする
//   instance             共用の Cloud SQL のインスタンスと、管理用のユーザー（postgres）のパスワード
//   shared               Artifact Registry、GitHub からの Workload Identity Federation、アクセスのログのバケット
//   db <staging|production>   DB とロール（db:roles:cloud を Cloud SQL Auth Proxy 越しに流す）と、接続先の URL の秘密の値
//   env <staging|production>  サービスアカウント、写真の入れ物、秘密の値、Cloud Run のサービスとマイグレーションの Job、権限
// 秘密の値は画面に出さない（Secret Manager には標準入力で渡す）
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  ARTIFACT_REPOSITORY, ENV_NAMES, GITHUB, INSTANCE, INSTANCE_CONNECTION, LOG_BUCKET, PROJECT_ID, PROVIDER_CONDITION, PROVIDER_MAPPING,
  REGION, SERVICES, deployPrincipal, envConfig, passwordOf, socketDatabaseUrl,
} from "./config.ts";
import type { EnvName } from "./config.ts";
import { CliGcloud } from "./lib/gcloud.ts";
import type { Gcloud } from "./lib/gcloud.ts";
import { CloudSqlProxy, readSecret } from "./lib/cloud-sql.ts";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const [step, envArg] = args.filter((a) => a !== "--dry-run");
const gcloud: Gcloud = new CliGcloud(dryRun);
const P = { project: PROJECT_ID };
const R = { ...P, region: REGION };

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
      // Cloud SQL Auth Proxy・Cloud Run のコネクタ（どちらも TLS）からだけつなぐ。承認済みのネットワークは足さない
      "ssl-mode": "ENCRYPTED_ONLY",
    });
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
  if (dryRun) {
    console.log(`▶ Cloud SQL Auth Proxy を起動し、npm --prefix backend run db:roles:cloud -- --env ${env}`);
    return;
  }
  const proxy = await CloudSqlProxy.start();
  try {
    const admin = readSecret(gcloud, INSTANCE.adminPasswordSecret);
    const migrator = passwordOf(readSecret(gcloud, c.secrets.databaseUrl));
    const app = passwordOf(readSecret(gcloud, c.secrets.appDatabaseUrl));
    console.log(`▶ npm --prefix backend run db:roles:cloud -- --env ${env}（Proxy 越し）`);
    // 手元のシェルに残った接続先（CLEANUP_DATABASE_URL など）を RoleSetup に読ませない
    const { CLEANUP_DATABASE_URL: _cleanup, METRICS_DATABASE_URL: _metrics, ...inherited } = process.env;
    const result = spawnSync(`npm --prefix backend run -s db:roles:cloud -- --env ${env}`, {
      shell: true,
      stdio: "inherit",
      env: {
        ...inherited,
        ADMIN_DATABASE_URL: proxy.url("postgres", admin, "postgres"),
        DATABASE_URL: proxy.url(c.roles.migrator, migrator, c.database),
        APP_DATABASE_URL: proxy.url(c.roles.app, app, c.database),
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
  const { run, migrate, deploy } = c.serviceAccounts;
  // Cloud SQL へつなぐ権限（インスタンスの単位では付けられない。DB に入れるかはロールのパスワードで分ける。docs/decisions/0056）
  for (const member of [run, migrate]) {
    gcloud.change(["projects", "add-iam-policy-binding", PROJECT_ID], { member: `serviceAccount:${member}`, role: "roles/cloudsql.client", condition: "None" });
  }

  // 写真の入れ物（非公開。docs/decisions/0037）
  if (!exists(["storage", "buckets", "describe", `gs://${c.bucket}`])) {
    gcloud.change(["storage", "buckets", "create", `gs://${c.bucket}`], { ...P, location: REGION, "uniform-bucket-level-access": true, "public-access-prevention": true });
  }
  gcloud.change(["storage", "buckets", "add-iam-policy-binding", `gs://${c.bucket}`], { member: `serviceAccount:${run}`, role: "roles/storage.objectAdmin" });

  ensureSecret(c.secrets.metricsToken, newSecretValue);
  ensureSecret(c.secrets.ipHashSecret, newSecretValue);
  for (const secret of [c.secrets.appDatabaseUrl, c.secrets.metricsToken, c.secrets.ipHashSecret]) {
    gcloud.change(["secrets", "add-iam-policy-binding", secret], { ...P, member: `serviceAccount:${run}`, role: "roles/secretmanager.secretAccessor" });
  }
  gcloud.change(["secrets", "add-iam-policy-binding", c.secrets.databaseUrl], { ...P, member: `serviceAccount:${migrate}`, role: "roles/secretmanager.secretAccessor" });

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

  // デプロイ用のサービスアカウント（docs/decisions/0055）。自分の環境のサービスと Job を変え、実行用のサービスアカウントとして動かせる
  gcloud.change(["run", "services", "add-iam-policy-binding", c.service], { ...R, member: `serviceAccount:${deploy}`, role: "roles/run.developer" });
  gcloud.change(["run", "jobs", "add-iam-policy-binding", c.migrateJob], { ...R, member: `serviceAccount:${deploy}`, role: "roles/run.developer" });
  for (const member of [run, migrate]) {
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
};

try {
  if (step === "apis") apis();
  else if (step === "instance") instance();
  else if (step === "shared") shared();
  else if (step === "db") await db(envName());
  else if (step === "env") env(envName());
  else throw new Error("使い方: npm run infra:setup -- <apis|instance|shared|db <env>|env <env>> [--dry-run]");
  console.log(dryRun ? "（--dry-run。何も変えていない）" : `✅ ${step}${envArg === undefined ? "" : ` ${envArg}`}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
