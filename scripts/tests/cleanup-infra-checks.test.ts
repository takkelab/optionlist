import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { INSTANCE_CONNECTION, cleanupRunUri, envConfig } from "../../infra/config.ts";
import { cleanupJobProblems, expectedGrants, policyProblems, projectPolicyProblems, schedulerProblems } from "../lib/infra-checks.ts";
import type { Binding, Grant, RunJob, SchedulerJob } from "../lib/infra-checks.ts";

// 削除のジョブ・Cloud Scheduler の infra:check（process.md §5 の R9。data.md §5）
const c = envConfig("production");
const toPolicy = (grants: Grant[]): { bindings: Binding[] } => ({ bindings: grants.map(([role, member]) => ({ role, members: [member] })) });

const job = (): RunJob => ({
  metadata: { labels: { "cloud.googleapis.com/location": "asia-northeast1" } },
  spec: {
    template: {
      metadata: { annotations: { "run.googleapis.com/cloudsql-instances": INSTANCE_CONNECTION } },
      spec: {
        template: {
          spec: {
            serviceAccountName: c.serviceAccounts.cleanup,
            maxRetries: 0,
            timeoutSeconds: 3600,
            containers: [{
              command: ["node"],
              args: ["--import", "tsx", "--max-semi-space-size=4", "src/jobs/cleanup.ts"],
              env: [
                { name: "APP_ENV", value: "production" },
                { name: "PHOTO_BUCKET", value: c.bucket },
                { name: "CLEANUP_DATABASE_URL", valueFrom: { secretKeyRef: { name: c.secrets.cleanupDatabaseUrl, key: "latest" } } },
              ],
            }],
          },
        },
      },
    },
  },
});

const scheduler = (): SchedulerJob => ({
  state: "ENABLED",
  schedule: "0 4 * * *",
  timeZone: "Asia/Tokyo",
  httpTarget: { uri: cleanupRunUri(c), httpMethod: "POST", oauthToken: { serviceAccountEmail: c.serviceAccounts.scheduler } },
});

describe("cleanupJobProblems", () => {
  it("ol_cleanup の秘密の値で、削除のジョブを流し直さずに 1 回だけ流すなら合格", () => {
    assert.deepEqual(cleanupJobProblems("production", job()), []);
  });

  it("アプリの接続先・別のコマンド・流し直し・別のサービスアカウントなら違反", () => {
    const wrong = structuredClone(job());
    const spec = wrong.spec?.template?.spec?.template?.spec;
    const container = spec?.containers?.[0];
    if (spec === undefined || container === undefined) throw new Error("形が違う");
    spec.maxRetries = 3;
    spec.serviceAccountName = c.serviceAccounts.run;
    container.args = ["--import", "tsx", "src/server.ts"];
    container.env = [{ name: "CLEANUP_DATABASE_URL", valueFrom: { secretKeyRef: { name: c.secrets.appDatabaseUrl, key: "latest" } } }];
    // サービスアカウント・コマンド・流し直し・接続先と、env を置き換えたので APP_ENV・PHOTO_BUCKET もない
    assert.equal(cleanupJobProblems("production", wrong).length, 6);
  });

  it("時間の制限が 1 時間でなければ違反（gcloud は文字列で返すこともある）", () => {
    const longer = structuredClone(job());
    const spec = longer.spec?.template?.spec?.template?.spec;
    if (spec === undefined) throw new Error("形が違う");
    spec.timeoutSeconds = "3600";
    assert.deepEqual(cleanupJobProblems("production", longer), []);
    spec.timeoutSeconds = 600;
    assert.equal(cleanupJobProblems("production", longer).length, 1);
  });

  it("Job がなければ違反", () => {
    assert.deepEqual(cleanupJobProblems("production", null), [`Cloud Run の Job ${c.cleanupJob} がない`]);
  });
});

describe("schedulerProblems", () => {
  it("ENABLED で、毎日 4 時（日本時間）に削除のジョブを起動するなら合格", () => {
    assert.deepEqual(schedulerProblems("production", scheduler()), []);
  });

  it("止まっている・時刻やタイムゾーンが違う・確認用の Job を起動する・別のサービスアカウントなら違反", () => {
    const wrong = { ...scheduler(), state: "PAUSED", schedule: "0 4 * * 1", timeZone: "Etc/UTC" };
    wrong.httpTarget = { uri: cleanupRunUri(envConfig("staging")), httpMethod: "POST", oauthToken: { serviceAccountEmail: c.serviceAccounts.cleanup } };
    assert.equal(schedulerProblems("production", wrong).length, 5);
  });

  it("Scheduler のジョブがなければ違反", () => {
    assert.equal(schedulerProblems("production", null).length, 1);
  });
});

describe("削除のジョブの権限", () => {
  const grants = expectedGrants("production");

  it("Job を起動できるのはスケジューラー用のサービスアカウントだけで、変えられるのはデプロイ用だけ", () => {
    assert.deepEqual(policyProblems("j", toPolicy(grants.cleanupJob), grants.cleanupJob), []);
    const runCanInvoke = toPolicy([...grants.cleanupJob, ["roles/run.invoker", `serviceAccount:${c.serviceAccounts.run}`]]);
    assert.equal(policyProblems("j", runCanInvoke, grants.cleanupJob).length, 1);
  });

  it("CLEANUP_DATABASE_URL を読めるのは削除のジョブのサービスアカウントだけ", () => {
    const [, expected] = grants.secrets.find(([name]) => name === c.secrets.cleanupDatabaseUrl) ?? ["", []];
    assert.deepEqual(expected, [["roles/secretmanager.secretAccessor", `serviceAccount:${c.serviceAccounts.cleanup}`]]);
  });

  it("写真の入れ物を触れるのはアプリと削除のジョブだけ", () => {
    assert.deepEqual(grants.bucket.map(([, member]) => member), [c.serviceAccounts.run, c.serviceAccounts.cleanup].map((e) => `serviceAccount:${e}`));
  });

  it("スケジューラー用のサービスアカウントは、誰にも名乗らせない", () => {
    const [, expected] = grants.runtimeAccounts.find(([email]) => email === c.serviceAccounts.scheduler) ?? ["", [["x", "y"]]];
    assert.deepEqual(expected, []);
  });

  it("削除のジョブのサービスアカウントの cloudsql.client が足りなければ違反", () => {
    const { run, migrate } = c.serviceAccounts;
    const policy = toPolicy([["roles/cloudsql.client", `serviceAccount:${run}`], ["roles/cloudsql.client", `serviceAccount:${migrate}`]]);
    assert.equal(projectPolicyProblems("production", policy).length, 1);
  });
});
