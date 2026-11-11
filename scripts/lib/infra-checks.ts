// infra:check の判定（architecture.md §4.1、process.md §5 の R8。docs/decisions/0055・0056・0057）
// 読むのは scripts/infra-check.ts（gcloud・gh・Cloud SQL Auth Proxy）。ここは読んだものを受け取って、違っているところを 1 行ずつ返す（空なら合格）
import {
  BACKUP, PHOTO_SOFT_DELETE_SECONDS, CLEANUP_JOB_ARGS, CLEANUP_JOB_TIMEOUT_SECONDS, CLEANUP_SCHEDULE, GITHUB, INSTANCE, INSTANCE_CONNECTION, LOG_BUCKET, PROJECT_ID, PROJECT_NUMBER, PROVIDER_CONDITION,
  PROVIDER_MAPPING, REGION, cleanupRunUri, deployPrincipal, envConfig,
} from "../../infra/config.ts";
import type { EnvName } from "../../infra/config.ts";

export type Binding = { role: string; members: string[] };
export type Policy = { bindings?: Binding[] } | null;
// 許す [役割, メンバー] の組。これ以外のメンバーが付いていたら違反、足りなければ違反
export type Grant = [role: string, member: string];

// リソースの IAM のポリシーに、決めた組だけがあることを確かめる（余分なものも、足りないものも違反）
// ignore: プロジェクトの持ち主など、どのリソースにも自動で付くもの
export const policyProblems = (label: string, policy: Policy, expected: Grant[], ignore: (member: string) => boolean = () => false): string[] => {
  if (policy === null) return [`${label}: IAM のポリシーを読めなかった`];
  const actual: Grant[] = (policy.bindings ?? []).flatMap((b) => b.members.filter((m) => !ignore(m)).map((m): Grant => [b.role, m]));
  const key = ([role, member]: Grant) => `${role} ${member}`;
  const want = new Set(expected.map(key));
  const have = new Set(actual.map(key));
  return [
    ...actual.filter((g) => !want.has(key(g))).map(([role, member]) => `${label}: 余分な権限 ${member} に ${role}`),
    ...expected.filter((g) => !have.has(key(g))).map(([role, member]) => `${label}: ${member} に ${role} がない`),
  ];
};

// プロジェクトの単位のポリシーは、この環境のサービスアカウントの分だけを見る（ほかのアプリや自分のアカウントの分は見ない）
export const projectPolicyProblems = (env: EnvName, policy: Policy): string[] => {
  const { run, migrate, cleanup, scheduler, deploy } = envConfig(env).serviceAccounts;
  // 書き出しの Job（本番だけ。data.md §6）も Cloud SQL につなぐ
  const backup = env === "production" ? [BACKUP.serviceAccount] : [];
  const mine = new Set([run, migrate, cleanup, scheduler, deploy, ...backup].map((e) => `serviceAccount:${e}`));
  // GitHub からの principal・principalSet にプロジェクトの単位で権限を付けると、サービスアカウントごとの条件を素通りする（docs/decisions/0055）
  const pool = `//iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${GITHUB.pool}`;
  const federated = (member: string) => member.startsWith(`principal:${pool}`) || member.startsWith(`principalSet:${pool}`);
  return policyProblems(
    `プロジェクト（${env} のサービスアカウントと GitHub からの principal）`,
    policy,
    [run, migrate, cleanup, ...backup].map((e): Grant => ["roles/cloudsql.client", `serviceAccount:${e}`]),
    (member) => !mine.has(member) && !federated(member),
  );
};

// アクセスのログ（Cloud Run のリクエストのログ）の行き先が東京のバケットであること（docs/decisions/0052・0057）
export const logSinkProblems = (sink: { destination?: string } | null): string[] => {
  const want = `logging.googleapis.com/projects/${PROJECT_ID}/locations/${REGION}/buckets/${LOG_BUCKET.name}`;
  if (sink === null) return ["ログのシンク _Default を読めなかった"];
  return sink.destination === want ? [] : [`ログのシンク _Default の行き先が東京のバケットでない（${sink.destination}）。プライバシーポリシーの「預け先」と合わなくなる`];
};

export type Secret = { replication?: { userManaged?: { replicas?: { location?: string }[] } } };

// 秘密の値は東京にだけ置く（docs/decisions/0057）
export const secretLocationProblems = (name: string, secret: Secret | null): string[] => {
  if (secret === null) return [`秘密の値 ${name} がない`];
  const locations = (secret.replication?.userManaged?.replicas ?? []).map((r) => r.location);
  return locations.length === 1 && locations[0] === REGION ? [] : [`秘密の値 ${name} の置き場所が ${REGION} だけでない（${locations.join("・") || "自動"}）`];
};

export type SqlInstance = {
  region?: string;
  databaseVersion?: string;
  settings?: {
    edition?: string;
    tier?: string;
    deletionProtectionEnabled?: boolean;
    retainBackupsOnDelete?: boolean;
    backupConfiguration?: {
      enabled?: boolean;
      pointInTimeRecoveryEnabled?: boolean;
      location?: string;
      transactionLogRetentionDays?: number;
      backupRetentionSettings?: { retainedBackups?: number };
    };
    ipConfiguration?: { authorizedNetworks?: unknown[]; sslMode?: string };
  };
};

export const instanceProblems = (instance: SqlInstance | null): string[] => {
  if (instance === null) return [`Cloud SQL のインスタンス ${INSTANCE.name} がない`];
  const s = instance.settings ?? {};
  const backup = s.backupConfiguration ?? {};
  const problems: string[] = [];
  const expect = (ok: boolean, message: string) => {
    if (!ok) problems.push(`インスタンス: ${message}`);
  };
  expect(instance.region === REGION, `地域が ${REGION} でない（${instance.region}）`);
  expect(instance.databaseVersion === INSTANCE.databaseVersion, `版が ${INSTANCE.databaseVersion} でない（${instance.databaseVersion}）`);
  expect(s.edition === INSTANCE.edition, `エディションが ${INSTANCE.edition} でない（${s.edition}）`);
  expect(s.tier === INSTANCE.tier, `マシンが ${INSTANCE.tier} でない（${s.tier}。費用が変わる。docs/decisions/0035）`);
  expect(s.deletionProtectionEnabled === true, "削除保護がない");
  expect(s.retainBackupsOnDelete === true, "インスタンスを消したときにバックアップを残す設定がない");
  expect(backup.enabled === true, "自動バックアップがない");
  expect(backup.pointInTimeRecoveryEnabled === true, "時点復旧がない");
  expect((backup.backupRetentionSettings?.retainedBackups ?? 0) >= INSTANCE.retainedBackups, `バックアップが ${INSTANCE.retainedBackups} 回分より少ない`);
  expect((backup.transactionLogRetentionDays ?? 0) >= INSTANCE.transactionLogDays, `時点復旧のログが ${INSTANCE.transactionLogDays} 日より短い`);
  // 書かないとマルチリージョン（asia）に置かれる。プライバシーポリシーの「東京リージョンに保存」と合わせる（docs/decisions/0061）
  expect(backup.location === INSTANCE.backupLocation, `バックアップの置き場所が ${INSTANCE.backupLocation} でない（${backup.location ?? "マルチリージョン"}）`);
  expect((s.ipConfiguration?.authorizedNetworks ?? []).length === 0, "承認済みのネットワークがある（Proxy とコネクタからだけつなぐ）");
  expect(s.ipConfiguration?.sslMode === "ENCRYPTED_ONLY", `暗号化していない接続を受け付ける（sslMode: ${s.ipConfiguration?.sslMode}）`);
  return problems;
};

export const cleanupJobProblems = (env: EnvName, job: RunJob | null): string[] => {
  const c = envConfig(env);
  if (job === null) return [`Cloud Run の Job ${c.cleanupJob} がない`];
  const task = job.spec?.template?.spec?.template?.spec ?? {};
  const container = task.containers?.[0];
  const vars = envMap(container);
  const problems: string[] = [];
  const expect = (ok: boolean, message: string) => {
    if (!ok) problems.push(`${c.cleanupJob}: ${message}`);
  };
  expect(job.metadata?.labels?.["cloud.googleapis.com/location"] === REGION, `地域が ${REGION} でない`);
  expect(task.serviceAccountName === c.serviceAccounts.cleanup, `サービスアカウントが ${c.serviceAccounts.cleanup} でない`);
  expect(job.spec?.template?.metadata?.annotations?.["run.googleapis.com/cloudsql-instances"] === INSTANCE_CONNECTION, "共用の Cloud SQL につないでいない");
  expect(vars.get("CLEANUP_DATABASE_URL") === `secret:${c.secrets.cleanupDatabaseUrl}`, `CLEANUP_DATABASE_URL が秘密の値 ${c.secrets.cleanupDatabaseUrl} でない`);
  expect(vars.get("PHOTO_BUCKET") === c.bucket, `PHOTO_BUCKET が ${c.bucket} でない`);
  // APP_ENV がないと、PHOTO_BUCKET が抜けたときに止まらない（docs/decisions/0059）
  expect(vars.get("APP_ENV") === env, `APP_ENV が ${env} でない`);
  expect([...(container?.command ?? []), ...(container?.args ?? [])].join(" ") === ["node", ...CLEANUP_JOB_ARGS].join(" "), "コマンドが削除のジョブでない");
  expect(task.maxRetries === 0, "失敗した削除のジョブを自動で流し直す設定になっている");
  expect(Number(task.timeoutSeconds) === CLEANUP_JOB_TIMEOUT_SECONDS, `時間の制限が ${CLEANUP_JOB_TIMEOUT_SECONDS} 秒でない（${task.timeoutSeconds}）`);
  return problems;
};

export const schedulerProblems = (env: EnvName, scheduler: SchedulerJob | null): string[] => {
  const c = envConfig(env);
  if (scheduler === null) return [`Cloud Scheduler ${c.cleanupScheduler} がない`];
  const target = scheduler.httpTarget ?? {};
  const expectedUri = cleanupRunUri(c);
  const problems: string[] = [];
  if (scheduler.state !== "ENABLED") problems.push(`${c.cleanupScheduler}: 状態が ENABLED でない（${scheduler.state}）`);
  if (scheduler.schedule !== CLEANUP_SCHEDULE.cron) problems.push(`${c.cleanupScheduler}: 実行時刻が毎日 4 時でない（${scheduler.schedule}）`);
  if (scheduler.timeZone !== CLEANUP_SCHEDULE.timeZone) problems.push(`${c.cleanupScheduler}: タイムゾーンが Asia/Tokyo でない（${scheduler.timeZone}）`);
  if (target.uri !== expectedUri) problems.push(`${c.cleanupScheduler}: Cloud Run Job の URI が違う（${target.uri}）`);
  if (target.httpMethod !== "POST") problems.push(`${c.cleanupScheduler}: HTTP メソッドが POST でない（${target.httpMethod}）`);
  if (target.oauthToken?.serviceAccountEmail !== c.serviceAccounts.scheduler) {
    problems.push(`${c.cleanupScheduler}: 呼び出し用サービスアカウントが ${c.serviceAccounts.scheduler} でない`);
  }
  return problems;
};

type EnvVar = { name: string; value?: string; valueFrom?: { secretKeyRef?: { name: string; key: string } } };
type Container = { env?: EnvVar[]; command?: string[]; args?: string[] };
type RevisionTemplate = {
  metadata?: { annotations?: Record<string, string> };
  spec?: { serviceAccountName?: string; containers?: Container[] };
};
export type RunService = {
  metadata?: { labels?: Record<string, string>; annotations?: Record<string, string> };
  spec?: { template?: RevisionTemplate };
};
export type RunJob = {
  metadata?: { labels?: Record<string, string> };
  spec?: { template?: { metadata?: { annotations?: Record<string, string> }; spec?: { template?: { spec?: { serviceAccountName?: string; containers?: Container[]; maxRetries?: number; timeoutSeconds?: number | string } } } } };
};

export type SchedulerJob = {
  state?: string;
  schedule?: string;
  timeZone?: string;
  httpTarget?: { uri?: string; httpMethod?: string; oauthToken?: { serviceAccountEmail?: string } };
};

export const envMap = (container: Container | undefined): Map<string, string> =>
  new Map((container?.env ?? []).map((e) => [e.name, e.value ?? `secret:${e.valueFrom?.secretKeyRef?.name ?? ""}`]));

export const serviceProblems = (env: EnvName, service: RunService | null): string[] => {
  const c = envConfig(env);
  if (service === null) return [`Cloud Run のサービス ${c.service} がない`];
  const template = service.spec?.template ?? {};
  const annotations = template.metadata?.annotations ?? {};
  const serviceAnnotations = service.metadata?.annotations ?? {};
  const vars = envMap(template.spec?.containers?.[0]);
  const problems: string[] = [];
  const expect = (ok: boolean, message: string) => {
    if (!ok) problems.push(`${c.service}: ${message}`);
  };
  expect(service.metadata?.labels?.["cloud.googleapis.com/location"] === REGION, `地域が ${REGION} でない`);
  // 台数はサービスの単位（run.googleapis.com/…Scale）とリビジョンの単位（autoscaling.knative.dev/…Scale）の両方にあり、別々に決まる
  // 最小は、書いてあればどちらも 0。最大は、どちらにも決めた値が書いてあること
  const levels = { サービス: serviceAnnotations["run.googleapis.com/minScale"], リビジョン: annotations["autoscaling.knative.dev/minScale"] };
  for (const [level, value] of Object.entries(levels)) {
    expect(value === undefined || Number(value) === 0, `${level}の単位の常駐する台数が 0 でない（${value}。費用が変わる。docs/decisions/0035）`);
  }
  const maxLevels = { サービス: serviceAnnotations["run.googleapis.com/maxScale"], リビジョン: annotations["autoscaling.knative.dev/maxScale"] };
  for (const [level, value] of Object.entries(maxLevels)) {
    expect(Number(value) === c.maxInstances, `${level}の単位の最大の台数が ${c.maxInstances} でない（${value ?? "書いていない"}）`);
  }
  expect(annotations["run.googleapis.com/cloudsql-instances"] === INSTANCE_CONNECTION, "共用の Cloud SQL につないでいない");
  expect(template.spec?.serviceAccountName === c.serviceAccounts.run, `サービスアカウントが ${c.serviceAccounts.run} でない`);
  expect(vars.get("APP_ENV") === env, `APP_ENV が ${env} でない`);
  expect(vars.get("APP_ORIGIN") === c.origin, `APP_ORIGIN が ${c.origin} でない`);
  expect(vars.get("PHOTO_BUCKET") === c.bucket, `PHOTO_BUCKET が ${c.bucket} でない`);
  expect(vars.get("APP_DATABASE_URL") === `secret:${c.secrets.appDatabaseUrl}`, `APP_DATABASE_URL が秘密の値 ${c.secrets.appDatabaseUrl} でない`);
  expect(vars.get("METRICS_TOKEN") === `secret:${c.secrets.metricsToken}`, `METRICS_TOKEN が秘密の値 ${c.secrets.metricsToken} でない`);
  expect(vars.get("IP_HASH_SECRET") === `secret:${c.secrets.ipHashSecret}`, `IP_HASH_SECRET が秘密の値 ${c.secrets.ipHashSecret} でない`);
  expect(!vars.has("DATABASE_URL"), "サービスに DATABASE_URL（ol_migrator）がある（マイグレーションの Job だけに渡す）");
  return problems;
};

export const jobProblems = (env: EnvName, job: RunJob | null): string[] => {
  const c = envConfig(env);
  if (job === null) return [`Cloud Run の Job ${c.migrateJob} がない`];
  const task = job.spec?.template?.spec?.template?.spec ?? {};
  const container = task.containers?.[0];
  const vars = envMap(container);
  const problems: string[] = [];
  const expect = (ok: boolean, message: string) => {
    if (!ok) problems.push(`${c.migrateJob}: ${message}`);
  };
  expect(job.metadata?.labels?.["cloud.googleapis.com/location"] === REGION, `地域が ${REGION} でない`);
  expect(task.serviceAccountName === c.serviceAccounts.migrate, `サービスアカウントが ${c.serviceAccounts.migrate} でない`);
  expect(job.spec?.template?.metadata?.annotations?.["run.googleapis.com/cloudsql-instances"] === INSTANCE_CONNECTION, "共用の Cloud SQL につないでいない");
  expect(vars.get("DATABASE_URL") === `secret:${c.secrets.databaseUrl}`, `DATABASE_URL が秘密の値 ${c.secrets.databaseUrl} でない`);
  expect([...(container?.command ?? []), ...(container?.args ?? [])].join(" ") === "dbmate --no-dump-schema --migrations-dir db/migrations migrate", "コマンドが dbmate migrate でない（migrate は DB を作らない）");
  expect(task.maxRetries === 0, "失敗したマイグレーションをやり直す設定になっている");
  return problems;
};

export type Bucket = {
  location?: string;
  public_access_prevention?: string;
  uniform_bucket_level_access?: boolean;
  soft_delete_policy?: { retentionDurationSeconds?: string | number };
  lifecycle_config?: { rule?: unknown[] };
};

export const bucketProblems = (env: EnvName, bucket: Bucket | null): string[] => {
  const c = envConfig(env);
  if (bucket === null) return [`入れ物 ${c.bucket} がない`];
  const problems: string[] = [];
  if (bucket.location?.toLowerCase() !== REGION) problems.push(`${c.bucket}: 地域が ${REGION} でない（${bucket.location}）`);
  if (bucket.public_access_prevention !== "enforced") problems.push(`${c.bucket}: 公開アクセスの防止が enforced でない`);
  if (bucket.uniform_bucket_level_access !== true) problems.push(`${c.bucket}: 均一なバケットレベルのアクセスでない（オブジェクトごとに公開できる）`);
  // 消した写真を 7 日間戻せる（data.md §6）
  const softDelete = Number(bucket.soft_delete_policy?.retentionDurationSeconds ?? 0);
  if (softDelete !== PHOTO_SOFT_DELETE_SECONDS) problems.push(`${c.bucket}: 消した写真を戻せる期間（soft delete）が 7 日でない（${softDelete} 秒）`);
  return problems;
};

// 入れ物には、プロジェクトの持ち主などの既定の権限（projectOwner: など）が自動で付く
export const isProjectConvenience = (member: string): boolean => /^project(Owner|Editor|Viewer):/.test(member);

export type Provider = { state?: string; attributeCondition?: string; attributeMapping?: Record<string, string>; oidc?: { issuerUri?: string } };

export const providerProblems = (provider: Provider | null): string[] => {
  if (provider === null) return [`Workload Identity Federation のプロバイダ ${GITHUB.provider} がない`];
  const problems: string[] = [];
  if (provider.state !== "ACTIVE") problems.push(`プロバイダ: 状態が ACTIVE でない（${provider.state}）`);
  if (provider.oidc?.issuerUri !== "https://token.actions.githubusercontent.com") problems.push("プロバイダ: 発行元が GitHub Actions でない");
  if (provider.attributeCondition !== PROVIDER_CONDITION) problems.push(`プロバイダ: 条件が repository_id・repository_owner_id で縛られていない（${provider.attributeCondition}）`);
  const mapping = provider.attributeMapping ?? {};
  const wantKeys = Object.keys(PROVIDER_MAPPING).toSorted();
  if (JSON.stringify(Object.keys(mapping).toSorted()) !== JSON.stringify(wantKeys)) problems.push(`プロバイダ: 属性の対応づけが ${wantKeys.join("・")} でない`);
  for (const [key, value] of Object.entries(PROVIDER_MAPPING)) {
    if (mapping[key] !== undefined && mapping[key] !== value) problems.push(`プロバイダ: ${key} の対応づけが決めた式でない（workflow_ref・event_name。docs/decisions/0055）`);
  }
  return problems;
};

export type Workflow = { path: string; content: string };

// GITHUB_TOKEN が workflow_dispatch を起動できないこと（docs/decisions/0055）
export const githubProblems = (defaultPermissions: string | null, workflows: Workflow[]): string[] => {
  const problems: string[] = [];
  if (defaultPermissions !== "read") problems.push(`GITHUB_TOKEN の既定の権限が read でない（${defaultPermissions ?? "読めなかった"}）`);
  for (const { path, content } of workflows) {
    // コメント（# から行末）は除いて探す（説明に書いた言葉で落ちないように）
    const code = content.split("\n").map((line) => line.replace(/(^|\s)#.*$/, "")).join("\n");
    // permissions: { actions: write } のような 1 行の書き方も拾う
    if (/\bactions\s*:\s*write\b/.test(code)) problems.push(`${path}: actions: write がある`);
    if (/write-all/.test(code)) problems.push(`${path}: write-all がある`);
  }
  return problems;
};

// 各環境のリソースに許す IAM（それ以外のメンバーは違反）。本番のデプロイ用のサービスアカウントは、確認用のサービスと Artifact Registry を読むだけ
export const expectedGrants = (env: EnvName) => {
  const c = envConfig(env);
  const sa = (email: string) => `serviceAccount:${email}`;
  const { run, migrate, cleanup, scheduler, deploy } = c.serviceAccounts;
  const productionDeploy = sa(envConfig("production").serviceAccounts.deploy);
  const backupAccess: Grant[] = env === "production" ? [["roles/secretmanager.secretAccessor", sa(BACKUP.serviceAccount)]] : [];
  return {
    service: [
      ["roles/run.invoker", "allUsers"],
      ["roles/run.developer", sa(deploy)],
      ...(env === "staging" ? [["roles/run.viewer", productionDeploy] as Grant] : []),
    ] as Grant[],
    job: [["roles/run.developer", sa(deploy)]] as Grant[],
    cleanupJob: [["roles/run.developer", sa(deploy)], ["roles/run.invoker", sa(scheduler)]] as Grant[],
    bucket: [["roles/storage.objectAdmin", sa(run)], ["roles/storage.objectAdmin", sa(cleanup)]] as Grant[],
    secrets: [
      [c.secrets.appDatabaseUrl, [["roles/secretmanager.secretAccessor", sa(run)]]],
      [c.secrets.metricsToken, [["roles/secretmanager.secretAccessor", sa(run)]]],
      [c.secrets.ipHashSecret, [["roles/secretmanager.secretAccessor", sa(run)]]],
      // 本番は書き出しの Job も ol_migrator でつなぐ（data.md §6）
      [c.secrets.databaseUrl, [["roles/secretmanager.secretAccessor", sa(migrate)], ...backupAccess]],
      [c.secrets.cleanupDatabaseUrl, [["roles/secretmanager.secretAccessor", sa(cleanup)]]],
      // metrics:usage -- --env が手元で読むだけ（プロジェクトの持ち主の自分）。誰にも付けない（metrics.md §6）
      [c.secrets.metricsDatabaseUrl, []],
    ] as [string, Grant[]][],
    runtimeAccounts: [
      [run, [["roles/iam.serviceAccountUser", sa(deploy)]]],
      [migrate, [["roles/iam.serviceAccountUser", sa(deploy)]]],
      [cleanup, [["roles/iam.serviceAccountUser", sa(deploy)]]],
      // Cloud Scheduler が名乗る。デプロイ用にも名乗らせない（Job の run.invoker だけを持つ。data.md §5）
      [scheduler, []],
      [deploy, [["roles/iam.workloadIdentityUser", deployPrincipal(env)]]],
      ...(env === "production" ? [[BACKUP.serviceAccount, [["roles/iam.serviceAccountUser", sa(deploy)]]]] : []),
    ] as [string, Grant[]][],
    // Artifact Registry は環境で共用。確認用が書き、本番は読むだけ
    repository: [
      ["roles/artifactregistry.writer", sa(envConfig("staging").serviceAccounts.deploy)],
      ["roles/artifactregistry.reader", productionDeploy],
    ] as Grant[],
  };
};

// DB（Cloud SQL Auth Proxy 越しに ol_migrator_<env> で読む）
export type DatabaseFacts = {
  // backend/db/checks/rls-checks.sql の検査ごとの違反（testing.md §7 の 2）
  rlsViolations: [check: string, rows: unknown[]][];
  // この環境の DB の持ち主
  owner: string;
  // この環境の DB に CONNECT できるロール（PUBLIC は "PUBLIC"）
  connectGrantees: string[];
  // ol_* のロールの属性
  roles: { name: string; login: boolean; createdb: boolean }[];
};

export const databaseProblems = (env: EnvName, facts: DatabaseFacts): string[] => {
  const c = envConfig(env);
  const problems = facts.rlsViolations.filter(([, rows]) => rows.length > 0).map(([check, rows]) => `${c.database}: rls-checks.sql の ${check} の違反 ${JSON.stringify(rows)}`);
  // 持ち主は環境ごとの ol_owner_<env>。ol_migrator（両方の環境で同じロール）が持ち主だと、確認用から本番の DB の権限を変えられる（docs/decisions/0056）
  if (facts.owner !== c.roles.owner) problems.push(`${c.database}: 持ち主が ${c.roles.owner} でない（${facts.owner}）`);
  // CONNECT は、持ち主と、この環境のログイン用のロールと、管理用のユーザー（postgres。どのみち持ち主に SET ROLE できる）だけ
  const allowed = new Set([c.roles.owner, "postgres", c.roles.migrator, c.roles.app, c.roles.cleanup, c.roles.metrics]);
  for (const grantee of facts.connectGrantees) if (!allowed.has(grantee)) problems.push(`${c.database}: ${grantee} が CONNECT できる`);
  for (const role of facts.roles) {
    const envLogin = /^ol_[a-z]+_(staging|production)$/.test(role.name) && !role.name.startsWith("ol_owner_");
    if (envLogin && !role.login) problems.push(`${role.name}: ログインできない`);
    if (!envLogin && role.login) problems.push(`${role.name}: グループのロールなのにログインできる（ログインは ${role.name}_<env> で行う）`);
    if (role.createdb) problems.push(`${role.name}: CREATEDB がある（確認用・本番では DB を作らない）`);
  }
  // ol_metrics_<env> は metrics:usage -- --env がつなぐ（metrics.md §6）
  for (const name of [c.roles.migrator, c.roles.app, c.roles.cleanup, c.roles.metrics]) if (!facts.roles.some((r) => r.name === name)) problems.push(`${name} がない`);
  return problems;
};
