// infra:check -- production の、週 1 の書き出し（data.md §6。docs/decisions/0041・0061）の判定
// 読むのは scripts/infra-check.ts。ここは読んだものを受け取って、違っているところを 1 行ずつ返す（空なら合格）
import { BACKUP, INSTANCE_CONNECTION, REGION, backupLifecycle, backupRunUri, envConfig } from "../../infra/config.ts";
import { envMap } from "./infra-checks.ts";
import type { Bucket, Grant, RunJob, SchedulerJob } from "./infra-checks.ts";

type LifecycleRule = { action?: { type?: string }; condition?: Record<string, unknown> };

export const backupJobProblems =(job: RunJob | null): string[] => {
  if (job === null) return [`Cloud Run の Job ${BACKUP.job} がない`];
  const task = job.spec?.template?.spec?.template?.spec ?? {};
  const container = task.containers?.[0];
  const vars = envMap(container);
  const problems: string[] = [];
  const expect = (ok: boolean, message: string) => {
    if (!ok) problems.push(`${BACKUP.job}: ${message}`);
  };
  expect(job.metadata?.labels?.["cloud.googleapis.com/location"] === REGION, `地域が ${REGION} でない`);
  expect(task.serviceAccountName === BACKUP.serviceAccount, `サービスアカウントが ${BACKUP.serviceAccount} でない`);
  expect(job.spec?.template?.metadata?.annotations?.["run.googleapis.com/cloudsql-instances"] === INSTANCE_CONNECTION, "共用の Cloud SQL につないでいない");
  // 書き出すのは本番の DB だけ（ol_migrator_production。--enable-row-security で全員の行が出る）
  expect(vars.get("DATABASE_URL") === `secret:${BACKUP.databaseUrlSecret}`, `DATABASE_URL が秘密の値 ${BACKUP.databaseUrlSecret} でない`);
  expect(vars.get("BACKUP_BUCKET") === BACKUP.bucket, `BACKUP_BUCKET が ${BACKUP.bucket} でない`);
  expect([...(container?.command ?? []), ...(container?.args ?? [])].join(" ") === ["node", ...BACKUP.args].join(" "), "コマンドが書き出しのジョブでない");
  expect(task.maxRetries === 0, "失敗した書き出しを自動で流し直す設定になっている");
  expect(Number(task.timeoutSeconds) === BACKUP.timeoutSeconds, `時間の制限が ${BACKUP.timeoutSeconds} 秒でない（${task.timeoutSeconds}）`);
  return problems;
};

export const backupSchedulerProblems = (scheduler: SchedulerJob | null): string[] => {
  if (scheduler === null) return [`Cloud Scheduler ${BACKUP.scheduler} がない`];
  const target = scheduler.httpTarget ?? {};
  const caller = envConfig("production").serviceAccounts.scheduler;
  const problems: string[] = [];
  const expect = (ok: boolean, message: string) => {
    if (!ok) problems.push(`${BACKUP.scheduler}: ${message}`);
  };
  expect(scheduler.state === "ENABLED", `状態が ENABLED でない（${scheduler.state}）`);
  expect(scheduler.schedule === BACKUP.schedule.cron, `実行時刻が日曜 5 時でない（${scheduler.schedule}）`);
  expect(scheduler.timeZone === BACKUP.schedule.timeZone, `タイムゾーンが Asia/Tokyo でない（${scheduler.timeZone}）`);
  expect(target.uri === backupRunUri(), `Cloud Run Job の URI が違う（${target.uri}）`);
  expect(target.httpMethod === "POST", `HTTP メソッドが POST でない（${target.httpMethod}）`);
  expect(target.oauthToken?.serviceAccountEmail === caller, `呼び出し用サービスアカウントが ${caller} でない`);
  return problems;
};

export const backupBucketProblems = (bucket: Bucket | null): string[] => {
  if (bucket === null) return [`入れ物 ${BACKUP.bucket} がない`];
  const problems: string[] = [];
  const expect = (ok: boolean, message: string) => {
    if (!ok) problems.push(`${BACKUP.bucket}: ${message}`);
  };
  expect(bucket.location?.toLowerCase() === REGION, `地域が ${REGION} でない（${bucket.location}）`);
  expect(bucket.public_access_prevention === "enforced", "公開アクセスの防止が enforced でない");
  expect(bucket.uniform_bucket_level_access === true, "均一なバケットレベルのアクセスでない（オブジェクトごとに公開できる）");
  // 35 日で消える（消したデータが書き出しに残るのは最長 5 週間。プライバシーポリシー。docs/decisions/0041）
  const rules = (bucket.lifecycle_config?.rule ?? []) as LifecycleRule[];
  const [want] = backupLifecycle().rule;
  const only = rules.length === 1 ? rules[0] : undefined;
  const condition = only?.condition ?? {};
  const matches = only?.action?.type === want?.action.type && Object.keys(condition).join() === "age" && Number(condition.age) === want?.condition.age;
  expect(matches, `ライフサイクルが ${BACKUP.retentionDays} 日で消すルールだけでない（${JSON.stringify(rules)}）`);
  // 消えたあとに戻せる期間があると、書き出しに残るのが 5 週間を超える
  const softDelete = Number(bucket.soft_delete_policy?.retentionDurationSeconds ?? 0);
  expect(softDelete === 0, `soft delete が付いている（${softDelete} 秒。35 日で消えたあとも残る）`);
  return problems;
};

// 書き出しの Job・入れ物に許す IAM。書き出しのサービスアカウントは作るだけ（読めない・消せない・上書きできない）
export const backupGrants = () => {
  const { scheduler, deploy } = envConfig("production").serviceAccounts;
  return {
    job: [["roles/run.invoker", `serviceAccount:${scheduler}`], ["roles/run.developer", `serviceAccount:${deploy}`]] as Grant[],
    bucket: [["roles/storage.objectCreator", `serviceAccount:${BACKUP.serviceAccount}`]] as Grant[],
  };
};
