import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { ENV_NAMES, IMAGE, PROJECT_ID, REGION, WORKLOAD_IDENTITY_PROVIDER, envConfig } from "../../infra/config.ts";
import { githubProblems } from "../lib/infra-checks.ts";

// deploy.yml の値が infra/config.ts（infra:setup・infra:check が使う）と同じで、0036・0055 の順番を守っていること（docs/decisions/0057）
// Windows で CRLF のままチェックアウトしても落ちないよう、改行をそろえてから読む
const workflow = readFileSync(".github/workflows/deploy.yml", "utf8").replaceAll("\r\n", "\n");
const jobBody = (name: string): string => {
  const start = workflow.indexOf(`\n  ${name}:\n`);
  assert.ok(start >= 0, `${name} のジョブがない`);
  const next = workflow.slice(start + 1).search(/\n {2}[a-z-]+:\n/);
  return next === -1 ? workflow.slice(start) : workflow.slice(start, start + 1 + next);
};
const stepIndex = (body: string, name: string): number => {
  const index = body.indexOf(`- name: ${name}`);
  assert.ok(index >= 0, `${name} のステップがない`);
  return index;
};

describe("deploy.yml", () => {
  it("プロジェクト・地域・プロバイダ・イメージの置き場所が infra/config.ts と同じ", () => {
    for (const value of [`PROJECT_ID: ${PROJECT_ID}`, `REGION: ${REGION}`, `WORKLOAD_IDENTITY_PROVIDER: ${WORKLOAD_IDENTITY_PROVIDER}`, `IMAGE: ${IMAGE}`]) {
      assert.ok(workflow.includes(value), value);
    }
  });

  for (const env of ENV_NAMES) {
    it(`${env} のサービス・Job・URL・デプロイ用のサービスアカウントが infra/config.ts と同じ`, () => {
      const c = envConfig(env);
      for (const value of [`SERVICE: ${c.service}`, `MIGRATE_JOB: ${c.migrateJob}`, `ORIGIN: ${c.origin}`, `service_account: ${c.serviceAccounts.deploy}`]) {
        assert.ok(jobBody(env).includes(value), value);
      }
    });

    // マイグレーションが失敗したら新しいイメージは出さない（0036）。出したら 100% がそのイメージか確かめる
    it(`${env} はマイグレーション → 出す → 100% の確かめ → /api/health の順で、--image は $DIGEST_IMAGE`, () => {
      const body = jobBody(env);
      const order = ["Migrate the", "Deploy to", "Check that the new image serves 100%", "Check /api/health"].map((name) => stepIndex(body, name));
      assert.deepEqual(order, order.toSorted((a, b) => a - b));
      for (const line of body.split("\n").filter((l) => /gcloud run (deploy|jobs update)/.test(l))) assert.match(line, /--image "\$DIGEST_IMAGE"/);
    });
  }

  it("確認用は push、本番は workflow_dispatch のときだけ、main で動く", () => {
    assert.match(jobBody("staging"), /\n\s+if: github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'\n/);
    assert.match(jobBody("production"), /\n\s+if: github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/main'\n/);
  });

  // 本番は確認用で動いているイメージをダイジェストで出す。作り直さない・コードを取ってこない（0055）
  it("本番のジョブは docker build も checkout もしない", () => {
    const body = jobBody("production");
    assert.doesNotMatch(body, /docker (build|push)/);
    assert.doesNotMatch(body, /actions\/checkout/);
  });

  // gcloud ... | jq の gcloud の失敗で止まるように（R8 の初回の本番で、権限の 403 が「100% のリビジョンがない」に隠れた）
  it("run は bash -eo pipefail で動く（defaults.run.shell: bash）", () => {
    assert.match(workflow, /\ndefaults:\n {2}run:\n {4}shell: bash\n/);
  });

  it("actions: write・write-all を与えていない", () => {
    assert.deepEqual(githubProblems("read", [{ path: "deploy.yml", content: workflow }]), []);
  });
});

// マイグレーションの Job はイメージの中の dbmate で流す。版は backend の dbmate と同じにする（docs/decisions/0057）
describe("Dockerfile の dbmate", () => {
  it("版が backend/package-lock.json の dbmate と同じ", () => {
    const lock = JSON.parse(readFileSync("backend/package-lock.json", "utf8")) as { packages: Record<string, { version?: string }> };
    const version = lock.packages["node_modules/dbmate"]?.version;
    const dockerfile = readFileSync("Dockerfile", "utf8");
    assert.match(dockerfile, new RegExp(`ghcr\\.io/amacneil/dbmate:${(version ?? "なし").replaceAll(".", "\\.")} `));
  });
});
