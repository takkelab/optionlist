// infra:check -- <staging|production> の、監視（metrics.md §8。docs/decisions/0042・0062）の判定
// 読むのは scripts/infra-check.ts（REST API）。ここは読んだものを受け取って、違っているところを 1 行ずつ返す（空なら合格）
// 決めた形は infra/monitoring.ts。サーバーが足す既定値で落ちないよう、決めた項目だけを取り出して比べる
import type { EnvName } from "../../infra/config.ts";
import {
  BUDGET_DISPLAY_NAME, CHANNEL_DISPLAY_NAME, CLIENT_ERROR_METRIC, alertPolicies, budgetBody, clientErrorMetricBody, policyPrefix, uptimeBody, uptimeCheckId, uptimeDisplayName,
} from "../../infra/monitoring.ts";
import type { AlertPolicy, Budget, Channel, Condition, LogMetric, UptimeCheck } from "../../infra/monitoring.ts";

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const sorted = (values: readonly string[] | undefined): string[] => [...(values ?? [])].sort();

// 運営者のメールの通知先がちょうど 1 つあること。合格なら name を返す（ポリシー・予算の確かめに使う）
export const channelProblems = (channels: Channel[] | null, email: string): { problems: string[]; channel: string | null } => {
  if (channels === null) return { problems: ["通知先（notificationChannels）を読めなかった"], channel: null };
  const found = channels.filter((c) => c.displayName === CHANNEL_DISPLAY_NAME);
  if (found.length !== 1) return { problems: [`通知先「${CHANNEL_DISPLAY_NAME}」が ${found.length} 個ある（1 個にする）`], channel: null };
  const [channel] = found;
  const problems: string[] = [];
  if (channel?.type !== "email") problems.push(`通知先「${CHANNEL_DISPLAY_NAME}」の種類がメールでない（${channel?.type}）`);
  // gcloud にログインしているアカウント（運営者）と同じアドレスか。アドレスそのものは画面に出さない
  if (channel?.labels?.email_address !== email) problems.push(`通知先「${CHANNEL_DISPLAY_NAME}」のアドレスが、gcloud にログインしているアカウントと違う`);
  if (channel?.enabled === false) problems.push(`通知先「${CHANNEL_DISPLAY_NAME}」が無効になっている`);
  return { problems, channel: channel?.name ?? null };
};

const comparableUptime = (u: UptimeCheck | undefined) => ({
  host: u?.monitoredResource?.labels?.host,
  type: u?.monitoredResource?.type,
  path: u?.httpCheck?.path,
  port: u?.httpCheck?.port,
  useSsl: u?.httpCheck?.useSsl ?? false,
  validateSsl: u?.httpCheck?.validateSsl ?? false,
  method: u?.httpCheck?.requestMethod ?? "GET",
  // 403 などを成功に数える設定が足されていないか（決めた形は 2xx だけ〈何も書かない〉）
  accepted: u?.httpCheck?.acceptedResponseStatusCodes ?? [],
  period: u?.period,
  timeout: u?.timeout,
  matchers: (u?.contentMatchers ?? []).map((m) => `${m.matcher ?? "CONTAINS_STRING"} ${m.content}`),
  regions: sorted(u?.selectedRegions),
});

// 死活監視がちょうど 1 つあり、決めた形であること。合格なら check_id を返す（死活監視のポリシーの確かめに使う）
export const uptimeProblems = (env: EnvName, checks: UptimeCheck[] | null): { problems: string[]; checkId: string | null } => {
  const label = `死活監視「${uptimeDisplayName(env)}」`;
  if (checks === null) return { problems: ["死活監視（uptimeCheckConfigs）を読めなかった"], checkId: null };
  const found = checks.filter((c) => c.displayName === uptimeDisplayName(env));
  if (found.length !== 1) return { problems: [`${label}が ${found.length} 個ある（1 個にする）`], checkId: null };
  const [check] = found;
  const want = comparableUptime(uptimeBody(env));
  const have = comparableUptime(check);
  const problems = same(want, have) ? [] : [`${label}の設定が違う（決めた形 ${JSON.stringify(want)}、今 ${JSON.stringify(have)}）`];
  return { problems, checkId: check?.name === undefined ? null : uptimeCheckId(check.name) };
};

export const logMetricProblems = (metric: LogMetric | null): string[] => {
  if (metric === null) return [`ログの指標 ${CLIENT_ERROR_METRIC} がない`];
  const pick = (m: LogMetric) => ({ filter: m.filter, valueExtractor: m.valueExtractor, valueType: m.metricDescriptor?.valueType, metricKind: m.metricDescriptor?.metricKind });
  const want = pick(clientErrorMetricBody());
  const have = pick(metric);
  return same(want, have) ? [] : [`ログの指標 ${CLIENT_ERROR_METRIC} の設定が違う（決めた形 ${JSON.stringify(want)}、今 ${JSON.stringify(have)}）`];
};

const comparableCondition = (c: Condition) => {
  const t = c.conditionThreshold;
  const q = c.conditionPrometheusQueryLanguage;
  const log = c.conditionMatchedLog;
  return {
    displayName: c.displayName,
    threshold: t === undefined ? null : {
      filter: t.filter,
      aggregations: (t.aggregations ?? []).map((a) => ({ ...a, groupByFields: sorted(a.groupByFields) })),
      comparison: t.comparison,
      thresholdValue: t.thresholdValue ?? 0,
      duration: t.duration ?? "0s",
      trigger: t.trigger?.count ?? 1,
    },
    promql: q === undefined ? null : { query: q.query, duration: q.duration ?? "0s", evaluationInterval: q.evaluationInterval ?? "60s" },
    log: log === undefined ? null : { filter: log.filter },
  };
};
const comparablePolicy = (p: AlertPolicy) => ({
  enabled: p.enabled ?? true,
  combiner: p.combiner,
  channels: sorted(p.notificationChannels),
  conditions: (p.conditions ?? []).map(comparableCondition),
  rateLimit: p.alertStrategy?.notificationRateLimit?.period ?? null,
  autoClose: p.alertStrategy?.autoClose ?? null,
});

// 決めたポリシーがちょうど 1 つずつ決めた形であり、この環境の名前のついた余分なポリシーがないこと
export const alertPolicyProblems = (env: EnvName, policies: AlertPolicy[] | null, channel: string | null, checkId: string | null): string[] => {
  if (policies === null) return ["アラートのポリシー（alertPolicies）を読めなかった"];
  // 通知先・死活監視が決まらないと形を比べられない（その違いは上で出している）。ポリシーがあるかだけを見る
  const wanted = alertPolicies(env, channel ?? "（通知先がない）", checkId ?? "（死活監視がない）");
  const problems: string[] = [];
  for (const want of wanted) {
    const found = policies.filter((p) => p.displayName === want.displayName);
    if (found.length !== 1) {
      problems.push(`アラートのポリシー「${want.displayName}」が ${found.length} 個ある（1 個にする）`);
      continue;
    }
    if (channel === null || checkId === null) continue;
    const [have] = found;
    if (have !== undefined && !same(comparablePolicy(want), comparablePolicy(have))) {
      problems.push(`アラートのポリシー「${want.displayName}」の設定が違う（決めた形 ${JSON.stringify(comparablePolicy(want))}、今 ${JSON.stringify(comparablePolicy(have))}）`);
    }
  }
  const names = new Set(wanted.map((p) => p.displayName));
  for (const extra of policies.filter((p) => p.displayName?.startsWith(policyPrefix(env)) === true && !names.has(p.displayName))) {
    problems.push(`決めていないアラートのポリシー「${extra.displayName}」がある（消すか、infra/monitoring.ts に書く）`);
  }
  return problems;
};

const comparableBudget = (b: Budget) => ({
  projects: sorted(b.budgetFilter?.projects),
  credits: b.budgetFilter?.creditTypesTreatment ?? "INCLUDE_ALL_CREDITS",
  period: b.budgetFilter?.calendarPeriod ?? "MONTH",
  amount: `${b.amount?.specifiedAmount?.units ?? "0"} ${b.amount?.specifiedAmount?.currencyCode}`,
  thresholds: (b.thresholdRules ?? []).map((r) => `${r.thresholdPercent} ${r.spendBasis ?? "CURRENT_SPEND"}`).sort(),
  channels: sorted(b.notificationsRule?.monitoringNotificationChannels),
  defaultRecipients: !(b.notificationsRule?.disableDefaultIamRecipients ?? false),
});

export const budgetProblems = (budgets: Budget[] | null, channel: string | null): string[] => {
  if (budgets === null) return ["予算（budgets）を読めなかった"];
  const found = budgets.filter((b) => b.displayName === BUDGET_DISPLAY_NAME);
  if (found.length !== 1) return [`予算「${BUDGET_DISPLAY_NAME}」が ${found.length} 個ある（1 個にする）`];
  if (channel === null) return [];
  const want = comparableBudget(budgetBody(channel));
  const have = found[0] === undefined ? null : comparableBudget(found[0]);
  return same(want, have) ? [] : [`予算「${BUDGET_DISPLAY_NAME}」の設定が違う（決めた形 ${JSON.stringify(want)}、今 ${JSON.stringify(have)}）`];
};
