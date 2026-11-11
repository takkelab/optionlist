// npm run infra:check -- <instance|staging|production>。環境の設定が決めたとおりかを gcloud・gh・DB で読んで確かめる（process.md §5 の R8）
// 違っているところを 1 行ずつ出し、1 つでもあれば終了コード 1。変えるのは infra/setup.ts（ここは読むだけ）
import { readFileSync } from "node:fs";
import pg from "pg";
import { backupBucketProblems, backupGrants, backupJobProblems, backupSchedulerProblems } from "./lib/backup-checks.ts";
import {
  ARTIFACT_REPOSITORY, BACKUP, ENV_NAMES, GITHUB, INSTANCE, PROJECT_ID, REGION, envConfig, passwordOf,
} from "../infra/config.ts";
import type { EnvName } from "../infra/config.ts";
import { CloudSqlProxy, readSecret } from "../infra/lib/cloud-sql.ts";
import { CliGcloud, readJson } from "../infra/lib/gcloud.ts";
import {
  bucketProblems, cleanupJobProblems, databaseProblems, expectedGrants, githubProblems, instanceProblems, isProjectConvenience, jobProblems, logSinkProblems,
  policyProblems, projectPolicyProblems, providerProblems, schedulerProblems, secretLocationProblems, serviceProblems,
} from "./lib/infra-checks.ts";
import type { Bucket, DatabaseFacts, Policy, Provider, RunJob, RunService, SchedulerJob, Secret, SqlInstance } from "./lib/infra-checks.ts";
import { spawnSync } from "node:child_process";

const target = process.argv[2];
const gcloud = new CliGcloud(false);
const P = { project: PROJECT_ID };
const R = { ...P, region: REGION };

// インスタンスと、環境をまたいで共用するもの（ログの行き先、管理用のパスワード）
const checkInstance = (): string[] => [
  ...instanceProblems(readJson<SqlInstance>(gcloud, ["sql", "instances", "describe", INSTANCE.name], P)),
  ...logSinkProblems(readJson<{ destination?: string }>(gcloud, ["logging", "sinks", "describe", "_Default"], P)),
  ...secretLocationProblems(INSTANCE.adminPasswordSecret, readJson<Secret>(gcloud, ["secrets", "describe", INSTANCE.adminPasswordSecret], P)),
  // 管理用のパスワードを読めれば両方の環境の DB に入れる。プロジェクトの持ち主（自分）のほかに誰にも付けない
  ...policyProblems(`秘密の値 ${INSTANCE.adminPasswordSecret} の IAM`, readJson<Policy>(gcloud, ["secrets", "get-iam-policy", INSTANCE.adminPasswordSecret], P), []),
];

const readRlsChecks = (): [string, string][] =>
  readFileSync("backend/db/checks/rls-checks.sql", "utf8")
    .split(/^-- check: /m)
    .slice(1)
    .map((section): [string, string] => {
      const [name = "", ...body] = section.split("\n");
      return [name.trim(), body.join("\n")];
    });

const readDatabase = async (env: EnvName): Promise<DatabaseFacts> => {
  const c = envConfig(env);
  const proxy = await CloudSqlProxy.start();
  try {
    const password = passwordOf(readSecret(gcloud, c.secrets.databaseUrl));
    const client = new pg.Client({ connectionString: proxy.url(c.roles.migrator, password, c.database) });
    await client.connect();
    try {
      const rlsViolations: [string, unknown[]][] = [];
      for (const [name, sql] of readRlsChecks()) rlsViolations.push([name, (await client.query(sql)).rows]);
      const connect = await client.query<{ grantee: string }>(
        `SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee
           FROM pg_database d, aclexplode(COALESCE(d.datacl, acldefault('d', d.datdba))) a
          WHERE d.datname = $1 AND a.privilege_type = 'CONNECT'`,
        [c.database],
      );
      const roles = await client.query<{ name: string; login: boolean; createdb: boolean }>(
        "SELECT rolname AS name, rolcanlogin AS login, rolcreatedb AS createdb FROM pg_roles WHERE rolname LIKE 'ol\\_%' ORDER BY 1",
      );
      const owner = await client.query<{ owner: string }>("SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname = $1", [c.database]);
      return { rlsViolations, owner: owner.rows[0]?.owner ?? "", connectGrantees: connect.rows.map((r) => r.grantee), roles: roles.rows };
    } finally {
      await client.end();
    }
  } finally {
    proxy.stop();
  }
};

// ワークフローは、手元の作業中のものではなく main のもの（実際に動くもの）を読む
const gh = (path: string): string | null => {
  const result = spawnSync(`gh api ${path}`, { shell: true, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  return result.status === 0 ? result.stdout : null;
};
const readGithub = (): { permissions: string | null; workflows: { path: string; content: string }[] } => {
  const repo = `repos/${GITHUB.repository}`;
  const permissions = gh(`${repo}/actions/permissions/workflow --jq .default_workflow_permissions`)?.trim() ?? null;
  const listing = JSON.parse(gh(`${repo}/contents/.github/workflows?ref=main`) ?? "[]") as { path: string; name: string }[];
  const workflows = listing
    .filter((f) => /\.ya?ml$/.test(f.name))
    .map((f) => ({ path: `main:${f.path}`, content: gh(`${repo}/contents/${f.path}?ref=main -H "Accept: application/vnd.github.raw"`) ?? "" }));
  return { permissions, workflows };
};

// 週 1 の書き出し（本番だけ。data.md §6）: Job・Scheduler・入れ物と、その IAM
const checkBackup = (policy: (args: string[], flags: Record<string, string>) => Policy): string[] => {
  const grants = backupGrants();
  return [
    ...backupJobProblems(readJson<RunJob>(gcloud, ["run", "jobs", "describe", BACKUP.job], R)),
    ...policyProblems(`${BACKUP.job} の IAM`, policy(["run", "jobs", "get-iam-policy", BACKUP.job], R), grants.job),
    ...backupSchedulerProblems(readJson<SchedulerJob>(gcloud, ["scheduler", "jobs", "describe", BACKUP.scheduler], { ...P, location: REGION })),
    ...backupBucketProblems(readJson<Bucket>(gcloud, ["storage", "buckets", "describe", `gs://${BACKUP.bucket}`], P)),
    ...policyProblems(`${BACKUP.bucket} の IAM`, policy(["storage", "buckets", "get-iam-policy", `gs://${BACKUP.bucket}`], P), grants.bucket, isProjectConvenience),
  ];
};

const checkEnv = async (env: EnvName): Promise<string[]> => {
  const c = envConfig(env);
  const grants = expectedGrants(env);
  const policy = (args: string[], flags: Record<string, string>): Policy => readJson<Policy>(gcloud, args, flags);
  const problems = [
    ...serviceProblems(env, readJson<RunService>(gcloud, ["run", "services", "describe", c.service], R)),
    ...policyProblems(`${c.service} の IAM`, policy(["run", "services", "get-iam-policy", c.service], R), grants.service),
    ...jobProblems(env, readJson<RunJob>(gcloud, ["run", "jobs", "describe", c.migrateJob], R)),
    ...policyProblems(`${c.migrateJob} の IAM`, policy(["run", "jobs", "get-iam-policy", c.migrateJob], R), grants.job),
    // 削除のジョブと、それを毎日 4 時に動かす Cloud Scheduler（data.md §5）
    ...cleanupJobProblems(env, readJson<RunJob>(gcloud, ["run", "jobs", "describe", c.cleanupJob], R)),
    ...policyProblems(`${c.cleanupJob} の IAM`, policy(["run", "jobs", "get-iam-policy", c.cleanupJob], R), grants.cleanupJob),
    ...schedulerProblems(env, readJson<SchedulerJob>(gcloud, ["scheduler", "jobs", "describe", c.cleanupScheduler], { ...P, location: REGION })),
    ...bucketProblems(env, readJson<Bucket>(gcloud, ["storage", "buckets", "describe", `gs://${c.bucket}`], P)),
    ...policyProblems(`${c.bucket} の IAM`, policy(["storage", "buckets", "get-iam-policy", `gs://${c.bucket}`], P), grants.bucket, isProjectConvenience),
    ...grants.secrets.flatMap(([secret, expected]) => [
      ...policyProblems(`秘密の値 ${secret} の IAM`, policy(["secrets", "get-iam-policy", secret], P), expected),
      ...secretLocationProblems(secret, readJson<Secret>(gcloud, ["secrets", "describe", secret], P)),
    ]),
    ...grants.runtimeAccounts.flatMap(([email, expected]) => policyProblems(`${email} の IAM`, policy(["iam", "service-accounts", "get-iam-policy", email], P), expected)),
    ...policyProblems(`Artifact Registry ${ARTIFACT_REPOSITORY} の IAM`, policy(["artifacts", "repositories", "get-iam-policy", ARTIFACT_REPOSITORY], { ...P, location: REGION }), grants.repository),
    ...projectPolicyProblems(env, policy(["projects", "get-iam-policy", PROJECT_ID], {})),
    ...providerProblems(readJson<Provider>(gcloud, ["iam", "workload-identity-pools", "providers", "describe", GITHUB.provider], { ...P, location: "global", "workload-identity-pool": GITHUB.pool })),
  ];
  if (env === "production") problems.push(...checkBackup(policy));
  const github = readGithub();
  problems.push(...githubProblems(github.permissions, github.workflows));
  problems.push(...(await readDatabase(env).then((facts) => databaseProblems(env, facts), (error: unknown) => [`${c.database}: 読めなかった（${error instanceof Error ? error.message : String(error)}）`])));
  return problems;
};

const env = ENV_NAMES.find((name) => name === target);
if (target !== "instance" && env === undefined) {
  console.error("使い方: npm run infra:check -- <instance|staging|production>");
  process.exit(1);
}
const problems = env === undefined ? checkInstance() : await checkEnv(env);
for (const problem of problems) console.error(`❌ ${problem}`);
console.log(problems.length === 0 ? `✅ infra:check ${target}` : `${problems.length} 件の違いがある`);
process.exit(problems.length === 0 ? 0 : 1);
