// 監視（metrics.md §8。docs/decisions/0042・0062）。通知先・死活監視・ログベースの指標・アラートのポリシー・予算の、決めた形
// infra/setup.ts（作る）と scripts/infra-check.ts（確かめる）が同じものを使う。メールアドレスと請求先アカウントはここに書かない（実行時に gcloud から読む）
// 本番は metrics.md §8 のすべて、確認用は死活監視だけ（デプロイの失敗などでメールが増えすぎないように）
import { BACKUP, PROJECT_ID, PROJECT_NUMBER, envConfig } from "./config.ts";
import type { EnvName } from "./config.ts";

export const MONITORING_ROOT = "https://monitoring.googleapis.com/v3";
export const MONITORING_API = `${MONITORING_ROOT}/projects/${PROJECT_ID}`;
export const LOGGING_API = `https://logging.googleapis.com/v2/projects/${PROJECT_ID}`;
export const BUDGETS_API = "https://billingbudgets.googleapis.com/v1";

// 通知先（確認用・本番で共用。運営者のメール 1 つ）
export const CHANNEL_DISPLAY_NAME = "optionlist 運営者のメール";
export type Channel = { name?: string; type?: string; displayName?: string; labels?: Record<string, string>; enabled?: boolean };
export const channelBody = (email: string): Channel => ({ type: "email", displayName: CHANNEL_DISPLAY_NAME, labels: { email_address: email }, enabled: true });

// 外からの死活監視（/api/health、5 分ごと）。3 つの地域から叩く（3 つが最小）
export type UptimeCheck = {
  name?: string;
  displayName?: string;
  monitoredResource?: { type?: string; labels?: Record<string, string> };
  httpCheck?: { path?: string; port?: number; useSsl?: boolean; validateSsl?: boolean; requestMethod?: string; acceptedResponseStatusCodes?: unknown[] };
  period?: string;
  timeout?: string;
  contentMatchers?: { content?: string; matcher?: string }[];
  selectedRegions?: string[];
};
export const uptimeDisplayName = (env: EnvName): string => `${envConfig(env).service} /api/health`;
export const uptimeBody = (env: EnvName): UptimeCheck => ({
  displayName: uptimeDisplayName(env),
  monitoredResource: { type: "uptime_url", labels: { project_id: PROJECT_ID, host: new URL(envConfig(env).origin).host } },
  httpCheck: { path: "/api/health", port: 443, useSsl: true, validateSsl: true, requestMethod: "GET" },
  period: "300s",
  timeout: "10s",
  contentMatchers: [{ content: '"status":"ok"', matcher: "CONTAINS_STRING" }],
  selectedRegions: ["ASIA_PACIFIC", "EUROPE", "USA_OREGON"],
});
// name は projects/<id>/uptimeCheckConfigs/<check_id>。指標のラベル check_id は最後の部分
export const uptimeCheckId = (name: string): string => name.split("/").pop() ?? "";

// client_error の件数（本番だけ）。backend が保存した件数を kind: client_error_received の counts.clientErrors に出す
export const CLIENT_ERROR_METRIC = "optionlist_production_client_errors";
export type LogMetric = {
  name?: string;
  description?: string;
  filter?: string;
  metricDescriptor?: { metricKind?: string; valueType?: string; unit?: string };
  valueExtractor?: string;
  bucketOptions?: { explicitBuckets?: { bounds?: number[] } };
};
const productionService = envConfig("production").service;
export const clientErrorMetricBody = (): LogMetric => ({
  name: CLIENT_ERROR_METRIC,
  description: "本番で受け取った client_error の件数（metrics.md §8）",
  filter: `resource.type="cloud_run_revision" AND resource.labels.service_name="${productionService}" AND jsonPayload.kind="client_error_received"`,
  metricDescriptor: { metricKind: "DELTA", valueType: "DISTRIBUTION", unit: "1" },
  valueExtractor: "EXTRACT(jsonPayload.counts.clientErrors)",
  bucketOptions: { explicitBuckets: { bounds: [1, 2, 5, 10, 20, 50] } },
});

export type Condition = {
  displayName?: string;
  conditionThreshold?: {
    filter?: string;
    aggregations?: { alignmentPeriod?: string; perSeriesAligner?: string; crossSeriesReducer?: string; groupByFields?: string[] }[];
    comparison?: string;
    thresholdValue?: number;
    duration?: string;
    trigger?: { count?: number };
  };
  conditionPrometheusQueryLanguage?: { query?: string; duration?: string; evaluationInterval?: string };
  conditionMatchedLog?: { filter?: string };
};
export type AlertPolicy = {
  name?: string;
  displayName?: string;
  documentation?: { content?: string; mimeType?: string };
  combiner?: string;
  enabled?: boolean;
  notificationChannels?: string[];
  conditions?: Condition[];
  alertStrategy?: { notificationRateLimit?: { period?: string }; autoClose?: string };
};

// PromQL の条件。25 時間より長く振り返る式は、続く時間（duration）を 0 にしなければならない
// 評価の間隔は、振り返る期間が長いほど長くしなければならない（1 日を超えると 5 分以上、8 日では 1 時間以上。API が断る）
const promql = (displayName: string, query: string, evaluationInterval = "60s"): Condition => ({
  displayName,
  conditionPrometheusQueryLanguage: { query, duration: "0s", evaluationInterval },
});
const jobExecutions = (job: string, result: "succeeded" | "failed"): string =>
  `run_googleapis_com:job_completed_execution_count{monitored_resource="cloud_run_job",job_name="${job}",result="${result}"}`;
// 失敗した実行（例外のほか、時間切れ・メモリ不足でログを出せずに落ちたものも数える）と、決めた期間に成功が 1 回もないこと
// PromQL の条件は 1 つのポリシーに 1 つしか置けないので、ポリシーを分ける
const jobFailed = (job: string): Condition => promql(`${job} が失敗した`, `sum(increase(${jobExecutions(job, "failed")}[1h])) > 0`);
const jobStale = (job: string, staleAfter: string, evaluationInterval: string): Condition =>
  promql(`${job} が ${staleAfter} 成功していない`, `absent_over_time(${jobExecutions(job, "succeeded")}[${staleAfter}])`, evaluationInterval);
const requests = (service: string, extra: string): string =>
  `sum(rate(run_googleapis_com:request_count{monitored_resource="cloud_run_revision",service_name="${service}"${extra}}[5m]))`;

// 死活監視の結果（check_passed は成功が 1、失敗が 0）
export const uptimeQuery = (checkId: string): string =>
  `count(max_over_time(monitoring_googleapis_com:uptime_check_check_passed{monitored_resource="uptime_url",check_id="${checkId}"}[9m]) == 0) > 1`;

export const policyPrefix =(env: EnvName): string => `${envConfig(env).service} `;

// 決めたアラートのポリシー（通知先と死活監視の ID は作ったあとで決まるので受け取る）
export const alertPolicies = (env: EnvName, channel: string, uptimeId: string): AlertPolicy[] => {
  const c = envConfig(env);
  const policy = (name: string, doc: string, conditions: Condition[], extra: Partial<AlertPolicy> = {}): AlertPolicy => ({
    displayName: `${policyPrefix(env)}${name}`,
    documentation: { content: `${doc}（metrics.md §8）`, mimeType: "text/markdown" },
    combiner: "OR",
    enabled: true,
    notificationChannels: [channel],
    conditions,
    ...extra,
  });
  // 地域ごとに直近 9 分の結果がすべて失敗（成功が 1 つもない）の地域が 2 つ以上なら鳴る。点検は 5 分ごとなので、
  // 9 分ずっと失敗なら少なくとも 2 回続けて失敗している。点の書かれる間隔（1 分ほど）や地域ごとの時刻のずれに左右されない
  const uptime = policy("死活監視", `${c.origin}/api/health が 2 回続けて失敗した`, [
    promql("/api/health が 2 回続けて失敗した", uptimeQuery(uptimeId)),
  ]);
  if (env === "staging") return [uptime];
  return [
    uptime,
    policy("5xx の割合", "5xx の割合が 5 分間で 5% を超えた", [
      promql("5xx の割合が 5% を超えた", `${requests(c.service, ',response_code_class="5xx"')} / ${requests(c.service, "")} > 0.05`),
    ]),
    // orphan_file_error は削除のジョブ（写真のファイルを消せなかったとき。data.md §5）も出すので、ジョブのログも見る
    // account_cleanup_error（引き継ぐ前のアカウントを消せず、残った）も拾う。db_pool_error は pg がつなぎ直すので拾わない（docs/decisions/0062）
    policy("エラーのログ", "unhandled_error・orphan_file_error・account_cleanup_error のログが出た。Cloud Logging で kind を絞って見る", [{
      displayName: "unhandled_error・orphan_file_error・account_cleanup_error のログ",
      conditionMatchedLog: {
        filter: `((resource.type="cloud_run_revision" AND resource.labels.service_name="${c.service}") OR (resource.type="cloud_run_job" AND resource.labels.job_name="${c.cleanupJob}")) AND jsonPayload.kind=("unhandled_error" OR "orphan_file_error" OR "account_cleanup_error")`,
      },
    }], { alertStrategy: { notificationRateLimit: { period: "300s" }, autoClose: "1800s" } }),
    policy("client_error の件数", "client_error が 1 時間に 50 件を超えた。多いメッセージは npm run metrics:usage -- --env production で見る", [
      promql("client_error が 1 時間に 50 件を超えた", `sum(increase(logging_googleapis_com:user_${CLIENT_ERROR_METRIC}_sum{monitored_resource="cloud_run_revision"}[1h])) > 50`),
    ]),
    policy("削除のジョブの失敗", "削除のジョブ（data.md §5）が失敗した。ログの kind: cleanup_failed を見る", [jobFailed(c.cleanupJob)]),
    policy("削除のジョブの止まり", "削除のジョブ（data.md §5）が 26 時間成功していない。Cloud Scheduler のジョブとログを見る", [jobStale(c.cleanupJob, "26h", "300s")]),
    policy("書き出しの失敗", "週 1 の書き出し（data.md §6）が失敗した。ログの kind: backup_failed を見る", [jobFailed(BACKUP.job)]),
    policy("書き出しの止まり", "週 1 の書き出し（data.md §6）が 8 日成功していない。Cloud Scheduler のジョブとログを見る", [jobStale(BACKUP.job, "8d", "3600s")]),
  ];
};

// 予算（本番の設定として作るが、対象はプロジェクト全体。月 3,000 円の 50・90・100%。docs/decisions/0035・0058）
// クレジットを引く前の金額で数える（無料トライアルの間も、実際の使い方が上限に近いかが分かるように。docs/decisions/0062）
export const BUDGET_DISPLAY_NAME = "optionlist 月 3,000 円";
export const BUDGET_THRESHOLDS = [0.5, 0.9, 1] as const;
export type Budget = {
  name?: string;
  displayName?: string;
  budgetFilter?: { projects?: string[]; creditTypesTreatment?: string; calendarPeriod?: string };
  amount?: { specifiedAmount?: { currencyCode?: string; units?: string } };
  thresholdRules?: { thresholdPercent?: number; spendBasis?: string }[];
  notificationsRule?: { monitoringNotificationChannels?: string[]; disableDefaultIamRecipients?: boolean };
};
export const budgetBody = (channel: string): Budget => ({
  displayName: BUDGET_DISPLAY_NAME,
  budgetFilter: { projects: [`projects/${PROJECT_NUMBER}`], creditTypesTreatment: "EXCLUDE_ALL_CREDITS", calendarPeriod: "MONTH" },
  amount: { specifiedAmount: { currencyCode: "JPY", units: "3000" } },
  thresholdRules: BUDGET_THRESHOLDS.map((thresholdPercent) => ({ thresholdPercent, spendBasis: "CURRENT_SPEND" })),
  // 請求先アカウントの管理者（自分）への既定のメールも残す
  notificationsRule: { monitoringNotificationChannels: [channel], disableDefaultIamRecipients: false },
});
