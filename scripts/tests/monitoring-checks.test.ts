import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BACKUP, envConfig } from "../../infra/config.ts";
import {
  BUDGET_DISPLAY_NAME, CHANNEL_DISPLAY_NAME, alertPolicies, budgetBody, channelBody, clientErrorMetricBody, uptimeBody, uptimeQuery,
} from "../../infra/monitoring.ts";
import type { AlertPolicy, UptimeCheck } from "../../infra/monitoring.ts";
import { masked } from "../../infra/lib/google-api.ts";
import { alertPolicyProblems, budgetProblems, channelProblems, logMetricProblems, uptimeProblems } from "../lib/monitoring-checks.ts";

const EMAIL = "operator@example.invalid";
const CHANNEL = "projects/p/notificationChannels/1";
const CHECK = "optionlist-production-api-health-abc";

describe("channelProblems", () => {
  const good = { ...channelBody(EMAIL), name: CHANNEL };

  it("運営者のメールの通知先が 1 つなら合格で、その name を返す", () => {
    assert.deepEqual(channelProblems([good], EMAIL), { problems: [], channel: CHANNEL });
  });

  // gcloud にログインしているアカウントと違うアドレスに送っていると、アラートに気づけない。アドレスは画面に出さない
  it("アドレスが違えば違反で、どちらのアドレスも出さない", () => {
    const { problems } = channelProblems([{ ...good, labels: { email_address: "someone@example.invalid" } }], EMAIL);
    assert.equal(problems.length, 1);
    assert.doesNotMatch(problems.join(), /example\.invalid/);
  });

  it("ない・2 つある・無効なら違反", () => {
    assert.equal(channelProblems([], EMAIL).channel, null);
    assert.equal(channelProblems([good, good], EMAIL).problems.length, 1);
    assert.equal(channelProblems([{ ...good, enabled: false }], EMAIL).problems.length, 1);
    assert.equal(channelProblems(null, EMAIL).problems.length, 1);
  });

  it("ほかの表示名の通知先は見ない", () => {
    assert.deepEqual(channelProblems([good, { displayName: "ほかのアプリ", type: "sms" }], EMAIL).problems, []);
  });
});

describe("uptimeProblems", () => {
  // サーバーが足す既定値（acceptedResponseStatusCodes など）では落ちない
  const good: UptimeCheck = { ...uptimeBody("production"), name: `projects/p/uptimeCheckConfigs/${CHECK}`, selectedRegions: ["USA_OREGON", "ASIA_PACIFIC", "EUROPE"] };

  it("決めた形なら合格で、check_id を返す（地域の順番は問わない）", () => {
    assert.deepEqual(uptimeProblems("production", [{ ...good, httpCheck: { ...good.httpCheck, acceptedResponseStatusCodes: [] } as UptimeCheck["httpCheck"] }]), { problems: [], checkId: CHECK });
  });

  it("確認用の死活監視は確認用の URL を叩く", () => {
    assert.equal(uptimeBody("staging").monitoredResource?.labels?.host, new URL(envConfig("staging").origin).host);
  });

  it("パス・間隔・中身の確かめが違えば違反", () => {
    assert.equal(uptimeProblems("production", [{ ...good, httpCheck: { ...good.httpCheck, path: "/" } }]).problems.length, 1);
    assert.equal(uptimeProblems("production", [{ ...good, period: "900s" }]).problems.length, 1);
    assert.equal(uptimeProblems("production", [{ ...good, contentMatchers: [] }]).problems.length, 1);
  });

  // 403 などを成功に数えると、落ちていても鳴らない
  it("2xx 以外を成功に数える設定が足されていれば違反", () => {
    const accepting = { ...good, httpCheck: { ...good.httpCheck, acceptedResponseStatusCodes: [{ statusClass: "STATUS_CLASS_4XX" }] } };
    assert.equal(uptimeProblems("production", [accepting]).problems.length, 1);
  });

  it("ないなら違反で、check_id は返さない", () => {
    assert.deepEqual(uptimeProblems("production", []).checkId, null);
  });
});

describe("logMetricProblems", () => {
  it("決めた形なら合格。数える値が違えば違反", () => {
    assert.deepEqual(logMetricProblems(clientErrorMetricBody()), []);
    assert.equal(logMetricProblems({ ...clientErrorMetricBody(), valueExtractor: undefined }).length, 1);
    assert.equal(logMetricProblems(null).length, 1);
  });

  // 本番のサービスの、backend が出す件数の行だけを数える
  it("本番のサービスの client_error_received の counts.clientErrors を数える", () => {
    const metric = clientErrorMetricBody();
    assert.match(metric.filter ?? "", /service_name="optionlist-production"/);
    assert.match(metric.filter ?? "", /jsonPayload\.kind="client_error_received"/);
    assert.equal(metric.valueExtractor, "EXTRACT(jsonPayload.counts.clientErrors)");
  });
});

describe("alertPolicies", () => {
  const all = alertPolicies("production", CHANNEL, CHECK);
  const queries = all.flatMap((p) => p.conditions ?? []).map((c) => c.conditionPrometheusQueryLanguage?.query ?? "");

  it("本番は metrics.md §8 の 8 つ（ジョブは失敗と止まりを分ける）、確認用は死活監視だけ", () => {
    assert.deepEqual(all.map((p) => p.displayName), [
      "optionlist-production 死活監視", "optionlist-production 5xx の割合", "optionlist-production エラーのログ",
      "optionlist-production client_error の件数", "optionlist-production 削除のジョブの失敗", "optionlist-production 削除のジョブの止まり",
      "optionlist-production 書き出しの失敗", "optionlist-production 書き出しの止まり",
    ]);
    assert.deepEqual(alertPolicies("staging", CHANNEL, CHECK).map((p) => p.displayName), ["optionlist-staging 死活監視"]);
  });

  it("どれも運営者のメールに送る", () => {
    for (const policy of all) assert.deepEqual(policy.notificationChannels, [CHANNEL]);
  });

  // metrics.md §8 の値
  it("しきい値は 5%・50 件・26 時間・8 日", () => {
    assert.ok(queries.some((q) => q.includes('response_code_class="5xx"') && q.endsWith("> 0.05")));
    assert.ok(queries.some((q) => q.includes("_sum{") && q.includes("[1h]") && q.endsWith("> 50")));
    assert.ok(queries.some((q) => q.startsWith("absent_over_time") && q.includes(`job_name="${envConfig("production").cleanupJob}"`) && q.endsWith("[26h])")));
    assert.ok(queries.some((q) => q.startsWith("absent_over_time") && q.includes(`job_name="${BACKUP.job}"`) && q.endsWith("[8d])")));
  });

  // 25 時間より長く振り返る PromQL は、続く時間を 0 にしないと作れない
  it("PromQL の条件は続く時間が 0", () => {
    for (const c of all.flatMap((p) => p.conditions ?? [])) {
      if (c.conditionPrometheusQueryLanguage !== undefined) assert.equal(c.conditionPrometheusQueryLanguage.duration, "0s");
    }
  });

  // orphan_file_error は削除のジョブも出す（写真のファイルを消せなかったとき。data.md §5）
  it("エラーのログは本番のサービスと削除のジョブの unhandled_error・orphan_file_error・account_cleanup_error を拾い、通知の間隔を決める", () => {
    const logs = all.find((p) => p.displayName?.endsWith("エラーのログ"));
    const filter = logs?.conditions?.[0]?.conditionMatchedLog?.filter ?? "";
    assert.match(filter, /\("unhandled_error" OR "orphan_file_error" OR "account_cleanup_error"\)/);
    assert.match(filter, /resource\.labels\.service_name="optionlist-production"/);
    assert.match(filter, new RegExp(`resource\\.type="cloud_run_job" AND resource\\.labels\\.job_name="${envConfig("production").cleanupJob}"`));
    assert.equal(logs?.alertStrategy?.notificationRateLimit?.period, "300s");
  });

  // 例外のほか、時間切れ・メモリ不足でログを出せずに落ちた実行も数える
  it("ジョブの失敗は、その Job の failed の実行が直近 1 時間に 1 つ以上", () => {
    for (const job of [envConfig("production").cleanupJob, BACKUP.job]) {
      assert.ok(queries.includes(`sum(increase(run_googleapis_com:job_completed_execution_count{monitored_resource="cloud_run_job",job_name="${job}",result="failed"}[1h])) > 0`), job);
    }
  });

  // 振り返る期間が長いと、評価の間隔を延ばさないと API が断る（26 時間は 5 分以上、8 日は 1 時間以上）
  it("止まりの評価の間隔は 26 時間なら 5 分、8 日なら 1 時間。ほかは 1 分", () => {
    const interval = (name: string) => all.find((p) => p.displayName?.endsWith(name))?.conditions?.[0]?.conditionPrometheusQueryLanguage?.evaluationInterval;
    assert.equal(interval("削除のジョブの止まり"), "300s");
    assert.equal(interval("書き出しの止まり"), "3600s");
    assert.equal(interval("5xx の割合"), "60s");
    assert.equal(interval("死活監視"), "60s");
  });

  // 点検は 5 分ごと。9 分ずっと成功がなければ、少なくとも 2 回続けて失敗している（metrics.md §8 の「2 回続けて」）
  it("死活監視は、9 分間成功がない地域が 2 つ以上で鳴る", () => {
    assert.equal(uptimeQuery(CHECK), `count(max_over_time(monitoring_googleapis_com:uptime_check_check_passed{monitored_resource="uptime_url",check_id="${CHECK}"}[9m]) == 0) > 1`);
    assert.ok(Number(uptimeBody("production").period?.replace("s", "")) * 2 > 9 * 60 - 300, "9 分の窓に点検が 2 回以上入る");
    assert.equal(all[0]?.conditions?.[0]?.conditionPrometheusQueryLanguage?.query, uptimeQuery(CHECK));
  });
});

describe("masked", () => {
  // dry-run の表示を PR やチャットに貼っても、メールアドレスと請求先アカウントの ID が漏れない
  it("メールアドレスと請求先アカウントの ID を伏せる", () => {
    const text = masked(`${JSON.stringify(channelBody(EMAIL))} https://x/v1/billingAccounts/0123-ABCD/budgets`);
    assert.doesNotMatch(text, /operator@|0123-ABCD/);
    assert.match(text, /billingAccounts\/（請求先アカウント）\/budgets/);
  });
});

describe("alertPolicyProblems", () => {
  // サーバーは name や、決めていない項目（作成者・evaluationInterval など）を足して返す
  const fromServer = (policies: AlertPolicy[]): AlertPolicy[] =>
    policies.map((p, i) => ({ ...p, name: `projects/p/alertPolicies/${i}`, creationRecord: { mutateTime: "x" } }) as AlertPolicy);
  const good = fromServer(alertPolicies("production", CHANNEL, CHECK));

  it("決めたとおりなら合格", () => {
    assert.deepEqual(alertPolicyProblems("production", good, CHANNEL, CHECK), []);
  });

  it("ない・無効・しきい値が違う・通知先がないなら違反", () => {
    assert.equal(alertPolicyProblems("production", good.slice(1), CHANNEL, CHECK).length, 1);
    const changed = structuredClone(good);
    if (changed[0] !== undefined) changed[0].enabled = false;
    const query = changed[1]?.conditions?.[0]?.conditionPrometheusQueryLanguage;
    if (query !== undefined) query.query = query.query?.replace("0.05", "0.5");
    if (changed[2] !== undefined) changed[2].notificationChannels = [];
    assert.equal(alertPolicyProblems("production", changed, CHANNEL, CHECK).length, 3);
  });

  it("別の死活監視を見ていれば違反", () => {
    assert.equal(alertPolicyProblems("production", fromServer(alertPolicies("production", CHANNEL, "other")), CHANNEL, CHECK).length, 1);
  });

  it("この環境の名前のついた、決めていないポリシーは違反。ほかの環境・アプリのものは見ない", () => {
    const extra = [...good, { displayName: "optionlist-production 古いもの" }, { displayName: "optionlist-staging 死活監視" }, { displayName: "ほかのアプリ" }];
    assert.equal(alertPolicyProblems("production", extra, CHANNEL, CHECK).length, 1);
  });

  // 通知先・死活監視の違いは別の行で出ているので、形の比べは飛ばし、あるかだけを見る
  it("通知先がまだなければ、あるかだけを見る", () => {
    assert.deepEqual(alertPolicyProblems("production", good, null, CHECK), []);
    assert.equal(alertPolicyProblems("production", [], null, CHECK).length, 8);
  });
});

describe("budgetProblems", () => {
  const good = { ...budgetBody(CHANNEL), name: "billingAccounts/x/budgets/y", thresholdRules: [{ thresholdPercent: 1 }, { thresholdPercent: 0.9 }, { thresholdPercent: 0.5 }] };

  it("月 3,000 円の 50・90・100% を運営者のメールに送るなら合格（順番は問わない）", () => {
    assert.deepEqual(budgetProblems([good], CHANNEL), []);
  });

  it("金額・割合・クレジットの扱い・通知先が違えば違反", () => {
    assert.equal(budgetProblems([{ ...good, amount: { specifiedAmount: { currencyCode: "JPY", units: "5000" } } }], CHANNEL).length, 1);
    assert.equal(budgetProblems([{ ...good, thresholdRules: [{ thresholdPercent: 1 }] }], CHANNEL).length, 1);
    assert.equal(budgetProblems([{ ...good, budgetFilter: { ...good.budgetFilter, creditTypesTreatment: "INCLUDE_ALL_CREDITS" } }], CHANNEL).length, 1);
    assert.equal(budgetProblems([{ ...good, notificationsRule: {} }], CHANNEL).length, 1);
  });

  it("ないなら違反", () => {
    assert.deepEqual(budgetProblems([], CHANNEL), [`予算「${BUDGET_DISPLAY_NAME}」が 0 個ある（1 個にする）`]);
  });

  it("通知先の表示名は決めたもの", () => {
    assert.equal(channelBody(EMAIL).displayName, CHANNEL_DISPLAY_NAME);
  });
});

describe("alertPolicies の PromQL", () => {
  // PromQL の条件は 1 つのポリシーに 1 つしか置けない（API が 400 で断る）
  it("PromQL の条件を持つポリシーは条件が 1 つだけ", () => {
    for (const policy of alertPolicies("production", CHANNEL, CHECK)) {
      if (policy.conditions?.some((c) => c.conditionPrometheusQueryLanguage !== undefined)) assert.equal(policy.conditions.length, 1, policy.displayName);
    }
  });
});
