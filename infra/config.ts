// 確認用・本番の環境の名前と設定（architecture.md §4.1。docs/decisions/0035・0036・0055・0056・0057）
// infra/setup.ts（作る）と scripts/infra-check.ts（確かめる）が同じ値を使う。秘密の値はここに書かない（Secret Manager に置く）

export type EnvName = "staging" | "production";
export const ENV_NAMES: readonly EnvName[] = ["staging", "production"];

export const PROJECT_ID = "project-2465a1be-8ac7-4a7e-99a";
export const PROJECT_NUMBER = "55327626788";
export const REGION = "asia-northeast1";

// 共用の Cloud SQL（今後作るアプリと共用する。docs/decisions/0035）
export const INSTANCE = {
  name: "takkelab-pg",
  databaseVersion: "POSTGRES_17",
  // PostgreSQL 16 以降は何も書かないと Enterprise Plus になり、共有コアを選べない
  edition: "ENTERPRISE",
  tier: "db-f1-micro",
  storageGb: 10,
  backupStartTime: "18:00", // UTC。日本時間の 3 時
  retainedBackups: 7,
  transactionLogDays: 7,
  // 管理用のユーザー（cloudsqlsuperuser。superuser ではない）のパスワード。db:roles:cloud だけが使う
  adminPasswordSecret: "takkelab-pg-postgres-password",
} as const;
export const INSTANCE_CONNECTION = `${PROJECT_ID}:${REGION}:${INSTANCE.name}`;

export const ARTIFACT_REPOSITORY = "optionlist";
export const IMAGE = `${REGION}-docker.pkg.dev/${PROJECT_ID}/${ARTIFACT_REPOSITORY}/optionlist`;

// アクセスのログを国内に置く（docs/decisions/0052・0057）。_Default のシンクの行き先をこのバケットにする
export const LOG_BUCKET = { name: "default-asia-northeast1", retentionDays: 30 } as const;

// GitHub Actions から入る Workload Identity Federation（docs/decisions/0055）
export const GITHUB = {
  repository: "takkelab/optionlist",
  repositoryId: "1449949385",
  repositoryOwnerId: "59127809",
  workflowRef: "takkelab/optionlist/.github/workflows/deploy.yml@refs/heads/main",
  pool: "github",
  provider: "optionlist-deploy",
} as const;

// 確認用は main への push、本番は workflow_dispatch のときだけ。ほかは none（どのサービスアカウントにも入れない）
export const DEPLOY_TARGET_MAPPING =
  `(assertion.workflow_ref == '${GITHUB.workflowRef}' && assertion.event_name == 'push') ? 'staging' : ` +
  `((assertion.workflow_ref == '${GITHUB.workflowRef}' && assertion.event_name == 'workflow_dispatch') ? 'production' : 'none')`;
export const PROVIDER_CONDITION =
  `assertion.repository_id == '${GITHUB.repositoryId}' && assertion.repository_owner_id == '${GITHUB.repositoryOwnerId}'`;
export const PROVIDER_MAPPING: Record<string, string> = {
  "google.subject": "assertion.sub",
  "attribute.repository_id": "assertion.repository_id",
  "attribute.deploy_target": DEPLOY_TARGET_MAPPING,
};
export const WORKLOAD_IDENTITY_PROVIDER = `projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${GITHUB.pool}/providers/${GITHUB.provider}`;
export const deployPrincipal = (env: EnvName): string =>
  `principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${GITHUB.pool}/attribute.deploy_target/${env}`;

export type EnvConfig = {
  env: EnvName;
  service: string;
  migrateJob: string;
  // 削除のジョブ（data.md §5）と、それを毎日 4 時（日本時間）に動かす Cloud Scheduler のジョブ
  cleanupJob: string;
  cleanupScheduler: string;
  bucket: string;
  database: string;
  maxInstances: number;
  // Cloud Run が決める URL（https://<サービス>-<プロジェクト番号>.<地域>.run.app）。独自ドメインは R11 の前に決める（docs/decisions/0057）
  origin: string;
  // scheduler: Cloud Scheduler が削除のジョブを起動するときに名乗る（Job の run.invoker だけを持つ）
  serviceAccounts: { run: string; migrate: string; cleanup: string; scheduler: string; deploy: string };
  secrets: { appDatabaseUrl: string; databaseUrl: string; cleanupDatabaseUrl: string; metricsToken: string; ipHashSecret: string };
  // owner: この環境の DB の持ち主（ログインしない。誰もメンバーにしない。docs/decisions/0056）
  roles: { migrator: string; app: string; cleanup: string; owner: string };
};

const sa = (id: string) => `${id}@${PROJECT_ID}.iam.gserviceaccount.com`;

export const envConfig = (env: EnvName): EnvConfig => ({
  env,
  service: `optionlist-${env}`,
  migrateJob: `optionlist-${env}-migrate`,
  cleanupJob: `optionlist-${env}-cleanup`,
  cleanupScheduler: `optionlist-${env}-cleanup-daily`,
  bucket: `optionlist-${env}-photos`,
  database: `optionlist_${env}`,
  maxInstances: env === "production" ? 3 : 2,
  origin: `https://optionlist-${env}-${PROJECT_NUMBER}.${REGION}.run.app`,
  serviceAccounts: {
    run: sa(`optionlist-${env}-run`),
    migrate: sa(`optionlist-${env}-migrate`),
    cleanup: sa(`optionlist-${env}-cleanup`),
    // サービスアカウントの ID は 30 文字まで（optionlist-production-scheduler は 31 文字になる）
    scheduler: sa(`optionlist-${env}-sched`),
    deploy: sa(`optionlist-${env}-deploy`),
  },
  secrets: {
    appDatabaseUrl: `optionlist-${env}-app-database-url`,
    databaseUrl: `optionlist-${env}-database-url`,
    cleanupDatabaseUrl: `optionlist-${env}-cleanup-database-url`,
    metricsToken: `optionlist-${env}-metrics-token`,
    ipHashSecret: `optionlist-${env}-ip-hash-secret`,
  },
  roles: { migrator: `ol_migrator_${env}`, app: `ol_app_${env}`, cleanup: `ol_cleanup_${env}`, owner: `ol_owner_${env}` },
});

// 削除のジョブ（data.md §5）。コマンドは Dockerfile の CMD と同じ形（--import tsx は backend のフォルダで探す）
export const CLEANUP_JOB_ARGS = ["--import", "tsx", "--max-semi-space-size=4", "src/jobs/cleanup.ts"] as const;
export const CLEANUP_JOB_TIMEOUT_SECONDS = 3600;
export const CLEANUP_SCHEDULE = { cron: "0 4 * * *", timeZone: "Asia/Tokyo" } as const;
// Cloud Scheduler が叩く、Cloud Run Job を起動する API
export const cleanupRunUri = (c: EnvConfig): string =>
  `https://run.googleapis.com/v2/projects/${PROJECT_ID}/locations/${REGION}/jobs/${c.cleanupJob}:run`;

// Cloud Run から Cloud SQL へは Unix ソケットでつなぐ（--add-cloudsql-instances）。pg（host）と dbmate（host を socket と同じに読む）の両方が読める形
// ホストが空の URL は WHATWG の URL では読めないので、文字列で組み立てる
export const socketDatabaseUrl = (user: string, password: string, database: string): string =>
  `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@/${database}?host=/cloudsql/${INSTANCE_CONNECTION}&sslmode=disable`;

export const passwordOf = (socketUrl: string): string => {
  const match = /^postgres:\/\/[^:]+:([^@]*)@/.exec(socketUrl);
  if (match === null) throw new Error("接続先の URL の形が違う（postgres://ユーザー:パスワード@/DB?host=...）");
  return decodeURIComponent(match[1] ?? "");
};

// 手元から Cloud SQL Auth Proxy 越しにつなぐときの URL（db:roles:cloud・infra:check）。Proxy が TLS で包むので sslmode=disable
export const PROXY_PORT = 5433;
export const proxyDatabaseUrl = (user: string, password: string, database: string): string =>
  `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@127.0.0.1:${PROXY_PORT}/${database}?sslmode=disable`;

// 有効にする API
export const SERVICES = [
  "run.googleapis.com",
  "sqladmin.googleapis.com",
  "secretmanager.googleapis.com",
  "artifactregistry.googleapis.com",
  "iam.googleapis.com",
  "iamcredentials.googleapis.com",
  "sts.googleapis.com",
  "cloudresourcemanager.googleapis.com",
  "logging.googleapis.com",
  "cloudscheduler.googleapis.com",
] as const;
