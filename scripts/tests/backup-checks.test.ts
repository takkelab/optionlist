import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BACKUP, INSTANCE_CONNECTION, backupRunUri, envConfig } from "../../infra/config.ts";
import { backupBucketProblems, backupGrants, backupJobProblems, backupSchedulerProblems } from "../lib/backup-checks.ts";
import { expectedGrants } from "../lib/infra-checks.ts";
import type { Bucket, RunJob, SchedulerJob } from "../lib/infra-checks.ts";

const goodJob = {
  metadata: { labels: { "cloud.googleapis.com/location": "asia-northeast1" } },
  spec: {
    template: {
      metadata: { annotations: { "run.googleapis.com/cloudsql-instances": INSTANCE_CONNECTION } },
      spec: {
        template: {
          spec: {
            serviceAccountName: BACKUP.serviceAccount,
            maxRetries: 0,
            timeoutSeconds: "3600",
            containers: [{
              command: ["node"],
              args: [...BACKUP.args],
              env: [
                { name: "APP_ENV", value: "production" },
                { name: "BACKUP_BUCKET", value: BACKUP.bucket },
                { name: "DATABASE_URL", valueFrom: { secretKeyRef: { name: BACKUP.databaseUrlSecret, key: "latest" } } },
              ],
            }],
          },
        },
      },
    },
  },
} satisfies RunJob;

describe("backupJobProblems", () => {
  it("決めた設定なら合格", () => {
    assert.deepEqual(backupJobProblems(goodJob), []);
  });

  // 確認用の DB を書き出したり、流し直したりしない
  it("ol_migrator の接続先が本番のものでなく、流し直す設定なら違反", () => {
    const bad = structuredClone(goodJob);
    const task = bad.spec.template.spec.template.spec;
    task.maxRetries = 3;
    const [container] = task.containers;
    const url = container?.env.find((e) => e.name === "DATABASE_URL");
    if (url?.valueFrom !== undefined) url.valueFrom.secretKeyRef.name = envConfig("staging").secrets.databaseUrl;
    assert.equal(backupJobProblems(bad).length, 2);
  });

  it("Job がなければ違反", () => {
    assert.equal(backupJobProblems(null).length, 1);
  });
});

describe("backupSchedulerProblems", () => {
  const good: SchedulerJob = {
    state: "ENABLED",
    schedule: "0 5 * * 0",
    timeZone: "Asia/Tokyo",
    httpTarget: { uri: backupRunUri(), httpMethod: "POST", oauthToken: { serviceAccountEmail: envConfig("production").serviceAccounts.scheduler } },
  };

  it("日曜 5 時（日本時間）に書き出しの Job を起動するなら合格", () => {
    assert.deepEqual(backupSchedulerProblems(good), []);
  });

  it("止まっていて、時刻が違えば違反", () => {
    assert.equal(backupSchedulerProblems({ ...good, state: "PAUSED", schedule: "0 5 * * *" }).length, 2);
  });
});

describe("backupBucketProblems", () => {
  const good: Bucket = {
    location: "ASIA-NORTHEAST1",
    public_access_prevention: "enforced",
    uniform_bucket_level_access: true,
    lifecycle_config: { rule: [{ condition: { age: 35 }, action: { type: "Delete" } }] },
  };

  it("東京・非公開・35 日で消えるなら合格（キーの順番は問わない）", () => {
    assert.deepEqual(backupBucketProblems(good), []);
  });

  // 35 日より長く残すと、消したデータがポリシーに書いた「最長 5 週間」より長く残る
  it("ライフサイクルがない・日数が違う・ほかの条件があれば違反", () => {
    assert.equal(backupBucketProblems({ ...good, lifecycle_config: undefined }).length, 1);
    assert.equal(backupBucketProblems({ ...good, lifecycle_config: { rule: [{ action: { type: "Delete" }, condition: { age: 90 } }] } }).length, 1);
    assert.equal(backupBucketProblems({ ...good, lifecycle_config: { rule: [{ action: { type: "Delete" }, condition: { age: 35, isLive: false } }] } }).length, 1);
  });

  // 新しい入れ物には既定で 7 日の soft delete が付く。35 日 ＋ 7 日でポリシーの「最長 5 週間」を超える
  it("soft delete が付いていれば違反。0 なら合格", () => {
    assert.equal(backupBucketProblems({ ...good, soft_delete_policy: { retentionDurationSeconds: "604800" } }).length, 1);
    assert.deepEqual(backupBucketProblems({ ...good, soft_delete_policy: { retentionDurationSeconds: "0" } }), []);
  });

  it("公開されうる入れ物は違反", () => {
    assert.equal(backupBucketProblems({ ...good, public_access_prevention: "inherited", uniform_bucket_level_access: false }).length, 2);
  });
});

describe("backupGrants", () => {
  // 書き出しのサービスアカウントは作るだけで、読めない・消せない
  it("入れ物には objectCreator だけ", () => {
    assert.deepEqual(backupGrants().bucket, [["roles/storage.objectCreator", `serviceAccount:${BACKUP.serviceAccount}`]]);
  });

  it("本番の ol_migrator の接続先は、マイグレーションと書き出しの Job だけが読める。確認用には足さない", () => {
    const production = expectedGrants("production").secrets.find(([name]) => name === envConfig("production").secrets.databaseUrl)?.[1] ?? [];
    assert.deepEqual(production.map(([, member]) => member), [`serviceAccount:${envConfig("production").serviceAccounts.migrate}`, `serviceAccount:${BACKUP.serviceAccount}`]);
    const staging = expectedGrants("staging").secrets.find(([name]) => name === envConfig("staging").secrets.databaseUrl)?.[1] ?? [];
    assert.equal(staging.length, 1);
  });
});
