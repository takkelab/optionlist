import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { INSTANCE_CONNECTION, PROVIDER_CONDITION, PROVIDER_MAPPING, envConfig } from "../../infra/config.ts";
import {
  bucketProblems, databaseProblems, expectedGrants, githubProblems, instanceProblems, isProjectConvenience, jobProblems, logSinkProblems, policyProblems,
  projectPolicyProblems, providerProblems, secretLocationProblems, serviceProblems,
} from "../lib/infra-checks.ts";
import type { Binding, Grant, RunService, SqlInstance } from "../lib/infra-checks.ts";

const toPolicy = (grants: Grant[]): { bindings: Binding[] } => {
  const byRole = new Map<string, string[]>();
  for (const [role, member] of grants) byRole.set(role, [...(byRole.get(role) ?? []), member]);
  return { bindings: [...byRole].map(([role, members]) => ({ role, members })) };
};

describe("policyProblems", () => {
  const staging = expectedGrants("staging");
  const productionDeploy = `serviceAccount:${envConfig("production").serviceAccounts.deploy}`;

  it("決めた組だけなら合格", () => {
    assert.deepEqual(policyProblems("s", toPolicy(staging.service), staging.service), []);
  });

  // 本番のデプロイ用のサービスアカウントは、確認用を読むだけ（docs/decisions/0055）
  it("本番のデプロイ用のサービスアカウントが確認用のサービスを変えられたら違反", () => {
    const policy = toPolicy([...staging.service, ["roles/run.developer", productionDeploy]]);
    assert.deepEqual(policyProblems("s", policy, staging.service), [`s: 余分な権限 ${productionDeploy} に roles/run.developer`]);
  });

  it("本番のデプロイ用のサービスアカウントが確認用の Job・秘密の値に何か持っていたら違反", () => {
    assert.equal(policyProblems("j", toPolicy([...staging.job, ["roles/run.viewer", productionDeploy]]), staging.job).length, 1);
    const [secret, expected] = staging.secrets[0] ?? ["", []];
    assert.equal(policyProblems(secret, toPolicy([...expected, ["roles/secretmanager.secretAccessor", productionDeploy]]), expected).length, 1);
  });

  it("足りない組も違反", () => {
    assert.deepEqual(policyProblems("j", toPolicy([]), staging.job), [`j: serviceAccount:${envConfig("staging").serviceAccounts.deploy} に roles/run.developer がない`]);
  });

  it("入れ物が公開されていたら違反。プロジェクトの持ち主などの既定の権限は見ない", () => {
    const policy = toPolicy([...staging.bucket, ["roles/storage.legacyBucketOwner", "projectOwner:p"], ["roles/storage.objectViewer", "allUsers"]]);
    assert.deepEqual(policyProblems("b", policy, staging.bucket, isProjectConvenience), ["b: 余分な権限 allUsers に roles/storage.objectViewer"]);
  });

  it("ポリシーを読めなければ違反", () => {
    assert.equal(policyProblems("x", null, []).length, 1);
  });

  it("プロジェクトの単位は、この環境のサービスアカウントだけを見る", () => {
    const { run, migrate, deploy } = envConfig("staging").serviceAccounts;
    const ok: Grant[] = [["roles/cloudsql.client", `serviceAccount:${run}`], ["roles/cloudsql.client", `serviceAccount:${migrate}`], ["roles/owner", "user:me@example.com"]];
    assert.deepEqual(projectPolicyProblems("staging", toPolicy(ok)), []);
    assert.equal(projectPolicyProblems("staging", toPolicy([...ok, ["roles/run.admin", `serviceAccount:${deploy}`]])).length, 1);
  });

  // サービスアカウントを通さずに、GitHub からの principalSet にプロジェクトの単位で権限を付けると、deploy_target の条件を素通りする
  it("GitHub からの principalSet にプロジェクトの単位で権限があれば違反", () => {
    const { run, migrate } = envConfig("staging").serviceAccounts;
    const ok: Grant[] = [["roles/cloudsql.client", `serviceAccount:${run}`], ["roles/cloudsql.client", `serviceAccount:${migrate}`]];
    const member = "principalSet://iam.googleapis.com/projects/55327626788/locations/global/workloadIdentityPools/github/attribute.deploy_target/staging";
    assert.equal(projectPolicyProblems("staging", toPolicy([...ok, ["roles/run.admin", member]])).length, 1);
  });
});

describe("instanceProblems", () => {
  const good: SqlInstance = {
    region: "asia-northeast1",
    databaseVersion: "POSTGRES_17",
    settings: {
      edition: "ENTERPRISE",
      tier: "db-f1-micro",
      deletionProtectionEnabled: true,
      retainBackupsOnDelete: true,
      backupConfiguration: { enabled: true, pointInTimeRecoveryEnabled: true, transactionLogRetentionDays: 7, backupRetentionSettings: { retainedBackups: 7 } },
      ipConfiguration: { authorizedNetworks: [], sslMode: "ENCRYPTED_ONLY" },
    },
  };

  it("決めた設定なら合格", () => {
    assert.deepEqual(instanceProblems(good), []);
  });

  it("削除保護・時点復旧がなく、承認済みのネットワークがあれば違反", () => {
    const bad: SqlInstance = {
      ...good,
      settings: { ...good.settings, deletionProtectionEnabled: false, backupConfiguration: { ...good.settings?.backupConfiguration, pointInTimeRecoveryEnabled: false }, ipConfiguration: { authorizedNetworks: [{}], sslMode: "ENCRYPTED_ONLY" } },
    };
    assert.equal(instanceProblems(bad).length, 3);
  });

  it("インスタンスがなければ違反", () => {
    assert.equal(instanceProblems(null).length, 1);
  });
});

describe("serviceProblems・jobProblems・bucketProblems", () => {
  const c = envConfig("production");
  const secret = (name: string) => ({ secretKeyRef: { name, key: "latest" } });
  const service: RunService = {
    metadata: { labels: { "cloud.googleapis.com/location": "asia-northeast1" }, annotations: { "run.googleapis.com/maxScale": "3" } },
    spec: {
      template: {
        metadata: { annotations: { "autoscaling.knative.dev/maxScale": "3", "run.googleapis.com/cloudsql-instances": INSTANCE_CONNECTION } },
        spec: {
          serviceAccountName: c.serviceAccounts.run,
          containers: [{
            env: [
              { name: "APP_ENV", value: "production" },
              { name: "APP_ORIGIN", value: c.origin },
              { name: "PHOTO_BUCKET", value: c.bucket },
              { name: "APP_DATABASE_URL", valueFrom: secret(c.secrets.appDatabaseUrl) },
              { name: "METRICS_TOKEN", valueFrom: secret(c.secrets.metricsToken) },
              { name: "IP_HASH_SECRET", valueFrom: secret(c.secrets.ipHashSecret) },
            ],
          }],
        },
      },
    },
  };

  it("決めた設定のサービスなら合格", () => {
    assert.deepEqual(serviceProblems("production", service), []);
  });

  it("常駐の台数があり、DATABASE_URL を渡していれば違反", () => {
    const bad = structuredClone(service);
    bad.metadata = { ...bad.metadata, annotations: { "run.googleapis.com/maxScale": "3", "run.googleapis.com/minScale": "1" } };
    bad.spec?.template?.spec?.containers?.[0]?.env?.push({ name: "DATABASE_URL", valueFrom: secret(c.secrets.databaseUrl) });
    assert.equal(serviceProblems("production", bad).length, 2);
  });

  // サービスの単位とリビジョンの単位は別々に決まる（R8 で、サービスの単位だけ 3 になっていた）
  it("最大の台数がサービスの単位とリビジョンの単位のどちらかで違えば違反", () => {
    const serviceLevel = structuredClone(service);
    serviceLevel.metadata = { ...serviceLevel.metadata, annotations: { "run.googleapis.com/maxScale": "10" } };
    assert.equal(serviceProblems("production", serviceLevel).length, 1);
    const revisionLevel = structuredClone(service);
    const annotations = revisionLevel.spec?.template?.metadata?.annotations ?? {};
    delete annotations["autoscaling.knative.dev/maxScale"];
    assert.equal(serviceProblems("production", revisionLevel).length, 1);
  });

  it("Job は dbmate migrate を、やり直さずに 1 回だけ流す", () => {
    const job = {
      metadata: { labels: { "cloud.googleapis.com/location": "asia-northeast1" } },
      spec: {
        template: {
          metadata: { annotations: { "run.googleapis.com/cloudsql-instances": INSTANCE_CONNECTION } },
          spec: {
            template: {
              spec: {
                serviceAccountName: c.serviceAccounts.migrate,
                maxRetries: 0,
                containers: [{ command: ["dbmate"], args: ["--no-dump-schema", "--migrations-dir", "db/migrations", "migrate"], env: [{ name: "DATABASE_URL", valueFrom: secret(c.secrets.databaseUrl) }] }],
              },
            },
          },
        },
      },
    };
    assert.deepEqual(jobProblems("production", job), []);
    const up = structuredClone(job);
    const container = up.spec.template.spec.template.spec.containers[0];
    if (container !== undefined) container.args = ["up"];
    assert.equal(jobProblems("production", up).length, 1);
  });

  it("入れ物は東京で、公開アクセスの防止が enforced", () => {
    assert.deepEqual(bucketProblems("staging", { location: "ASIA-NORTHEAST1", public_access_prevention: "enforced", uniform_bucket_level_access: true }), []);
    assert.equal(bucketProblems("staging", { location: "US", public_access_prevention: "inherited", uniform_bucket_level_access: false }).length, 3);
  });
});

describe("providerProblems", () => {
  const good = { state: "ACTIVE", attributeCondition: PROVIDER_CONDITION, attributeMapping: { ...PROVIDER_MAPPING }, oidc: { issuerUri: "https://token.actions.githubusercontent.com" } };

  it("repository_id・repository_owner_id・workflow_ref・event_name で縛っていれば合格", () => {
    assert.deepEqual(providerProblems(good), []);
  });

  it("条件がリポジトリ名だけなら違反", () => {
    assert.equal(providerProblems({ ...good, attributeCondition: "assertion.repository == 'takkelab/optionlist'" }).length, 1);
  });

  it("deploy_target の式が event_name を見ていなければ違反", () => {
    const mapping = { ...PROVIDER_MAPPING, "attribute.deploy_target": "'production'" };
    assert.equal(providerProblems({ ...good, attributeMapping: mapping }).length, 1);
  });
});

describe("githubProblems", () => {
  it("既定の権限が read で、actions: write・write-all がなければ合格", () => {
    assert.deepEqual(githubProblems("read", [{ path: "ci.yml", content: "permissions:\n  contents: read\n" }]), []);
  });

  it("既定の権限が write、actions: write・write-all があれば違反", () => {
    const workflows = [{ path: "a.yml", content: "permissions:\n  actions: write\n" }, { path: "b.yml", content: "permissions: write-all\n" }];
    assert.equal(githubProblems("write", workflows).length, 3);
  });

  it("1 行の書き方の actions: write も違反。コメントの中は見ない", () => {
    assert.equal(githubProblems("read", [{ path: "c.yml", content: "permissions: { contents: read, actions: write }\n" }]).length, 1);
    assert.deepEqual(githubProblems("read", [{ path: "d.yml", content: "# actions: write・write-all は与えない\npermissions:\n  contents: read\n" }]), []);
  });
});

describe("databaseProblems", () => {
  const roles = [
    { name: "ol_app", login: false, createdb: false },
    { name: "ol_app_staging", login: true, createdb: false },
    { name: "ol_migrator", login: false, createdb: false },
    { name: "ol_migrator_staging", login: true, createdb: false },
    { name: "ol_owner_staging", login: false, createdb: false },
  ];
  const good = {
    rlsViolations: [["no_bypassrls_or_superuser", []]] as [string, unknown[]][],
    owner: "ol_owner_staging",
    connectGrantees: ["ol_owner_staging", "postgres", "ol_migrator_staging", "ol_app_staging"],
    roles,
  };

  it("持ち主が ol_owner_staging で、CONNECT がこの環境のログイン用のロールだけで、RLS の違反がなければ合格", () => {
    assert.deepEqual(databaseProblems("staging", good), []);
  });

  it("PUBLIC・本番のロールが CONNECT でき、グループのロールにログインできれば違反", () => {
    const facts = {
      ...good,
      rlsViolations: [["strong_role_memberships", [{ violation: "x → ol_migrator" }]]] as [string, unknown[]][],
      connectGrantees: [...good.connectGrantees, "PUBLIC", "ol_app_production"],
      roles: [...roles.filter((r) => r.name !== "ol_app"), { name: "ol_app", login: true, createdb: false }],
    };
    assert.equal(databaseProblems("staging", facts).length, 4);
  });

  // 両方の環境で同じ ol_migrator が持ち主だと、確認用から本番の DB の CONNECT を足す・DB を消すことができる（docs/decisions/0056）
  it("持ち主が ol_migrator（両方の環境で共通のロール）なら違反", () => {
    assert.deepEqual(databaseProblems("staging", { ...good, owner: "ol_migrator", connectGrantees: ["ol_migrator", "ol_migrator_staging", "ol_app_staging"] }), [
      "optionlist_staging: 持ち主が ol_owner_staging でない（ol_migrator）",
      "optionlist_staging: ol_migrator が CONNECT できる",
    ]);
  });
});

describe("logSinkProblems・secretLocationProblems", () => {
  it("_Default の行き先が東京のバケットなら合格", () => {
    assert.deepEqual(logSinkProblems({ destination: "logging.googleapis.com/projects/project-2465a1be-8ac7-4a7e-99a/locations/asia-northeast1/buckets/default-asia-northeast1" }), []);
    assert.equal(logSinkProblems({ destination: "logging.googleapis.com/projects/project-2465a1be-8ac7-4a7e-99a/locations/global/buckets/_Default" }).length, 1);
  });

  it("秘密の値は東京にだけ置く", () => {
    assert.deepEqual(secretLocationProblems("s", { replication: { userManaged: { replicas: [{ location: "asia-northeast1" }] } } }), []);
    assert.equal(secretLocationProblems("s", { replication: {} }).length, 1);
    assert.equal(secretLocationProblems("s", { replication: { userManaged: { replicas: [{ location: "asia-northeast1" }, { location: "us-central1" }] } } }).length, 1);
  });
});
