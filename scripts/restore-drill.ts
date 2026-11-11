// npm run ops:restore-drill -- <staging|production>。復旧の訓練（data.md §6 の 1〜6。docs/decisions/0041・0061）
// その場でバックアップを取り、一時的なインスタンス（restore-drill-<日時>）に戻して、バックアップの前後に残っていた
// 利用者の表の ID がすべて戻ったかと、「行があるのに写真がない」を確かめる。結果は docs/ops/restore-drills.md に 1 行足す
// 有料のインスタンスを数十分作る。成功しても失敗しても、一時的なインスタンスとその場のバックアップは消す（消せなかったら止まって知らせる）
import { readFileSync, writeFileSync } from "node:fs";
import pg from "pg";
import { DRILL_PROXY_PORT, ENV_NAMES, INSTANCE, PROJECT_ID, REGION, envConfig, passwordOf } from "../infra/config.ts";
import { CloudSqlProxy, readSecret } from "../infra/lib/cloud-sql.ts";
import { CliGcloud, readJson } from "../infra/lib/gcloud.ts";
import type { Flags } from "../infra/lib/gcloud.ts";
import { DRILL_TABLES, appendRow, bucketFileNames, drillInstanceName, drillRow, judgeDrill } from "./lib/restore-drill.ts";
import type { DrillResult, DrillTable, IdSets } from "./lib/restore-drill.ts";

const LOG_FILE = "docs/ops/restore-drills.md";
const env = ENV_NAMES.find((name) => name === process.argv[2]);
if (env === undefined) {
  console.error("使い方: npm run ops:restore-drill -- <staging|production>");
  process.exit(1);
}
const c = envConfig(env);
const gcloud = new CliGcloud(false);
const P = { project: PROJECT_ID };
const now = new Date();
const drillName = drillInstanceName(now);

// 長くかかる操作（インスタンスの作成・戻す・消す・バックアップ）は --async で始めて、終わるまで待つ（gcloud の既定の待ち時間で切れないように）
const runOperation = (args: string[], flags: Flags): void => {
  const started = gcloud.change(args, { ...flags, async: true, format: "json" });
  const operation = (JSON.parse(started.stdout) as { name?: string }).name ?? "";
  if (operation === "") throw new Error(`操作の名前を読めなかった: ${started.stdout}`);
  gcloud.change(["sql", "operations", "wait", operation], { ...P, timeout: "unlimited" });
};

const withClient = async <T>(proxy: CloudSqlProxy, password: string, fn: (client: pg.Client) => Promise<T>): Promise<T> => {
  const client = new pg.Client({ connectionString: proxy.url(c.roles.migrator, password, c.database) });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
};

// 表の名前は DRILL_TABLES の固定の値だけ（利用者の入力ではない）
const readIds = async (client: pg.Client, max: Record<DrillTable, number> | null): Promise<IdSets> => {
  const sets = { users: [], options: [], achievements: [] } as IdSets;
  for (const table of DRILL_TABLES) {
    const rows = await client.query<{ id: string }>(`SELECT id FROM ${table} WHERE $1::bigint IS NULL OR id <= $1 ORDER BY id`, [max?.[table] ?? null]);
    sets[table] = rows.rows.map((r) => Number(r.id));
  }
  return sets;
};

const readMax = async (client: pg.Client): Promise<Record<DrillTable, number>> => {
  const max = { users: 0, options: 0, achievements: 0 };
  for (const table of DRILL_TABLES) {
    const rows = await client.query<{ max: string | null }>(`SELECT max(id) AS max FROM ${table}`);
    max[table] = Number(rows.rows[0]?.max ?? 0);
  }
  return max;
};

const readPhotos = async (client: pg.Client, ids: number[]): Promise<Map<number, string | null>> => {
  const rows = await client.query<{ id: string; photo_filename: string | null }>("SELECT id, photo_filename FROM achievements WHERE id = ANY($1::bigint[])", [ids]);
  return new Map(rows.rows.map((r) => [Number(r.id), r.photo_filename]));
};

const drill = async (cleanup: Cleanup): Promise<DrillResult> => {
  const password = passwordOf(readSecret(gcloud, c.secrets.databaseUrl));
  // 1〜3: 今の DB の最大の ID M → その場でバックアップ → 直後に M 以下の ID の集合 S′
  const shared = await CloudSqlProxy.start();
  const before = await (async () => {
    try {
      return await withClient(shared, password, async (client) => {
        const max = await readMax(client);
        console.log(`▶ M（表ごとの最大の ID）: ${JSON.stringify(max)}`);
        // 本番の訓練でも国内に置く（インスタンスの設定に頼らず明示する。docs/decisions/0061）
        cleanup.backupStarted = true;
        runOperation(["sql", "backups", "create"], { ...P, instance: INSTANCE.name, description: drillName, location: INSTANCE.backupLocation });
        const [found] = findDrillBackups();
        if (found === undefined) throw new Error("その場で取ったバックアップが一覧にない");
        cleanup.backupId = found;
        const kept = await readIds(client, max);
        return { kept, photos: await readPhotos(client, kept.achievements), backupId: found };
      });
    } finally {
      shared.stop();
    }
  })();
  const listing = gcloud.read(["storage", "ls", `gs://${c.bucket}`], P);
  if (!listing.ok) throw new Error(`写真の入れ物 ${c.bucket} を読めなかった\n${listing.stderr}`);
  const bucketFiles = bucketFileNames(c.bucket, listing.stdout);

  // 4: 一時的なインスタンスを作り、そのバックアップを戻して R を読む（自動バックアップ・削除保護なし。数十分で消す）
  // 戻す先は元以上の容量が要る。共用のインスタンスは容量が自動で増えるので、今の容量を読む
  const source = readJson<{ settings?: { dataDiskSizeGb?: string } }>(gcloud, ["sql", "instances", "describe", INSTANCE.name], P);
  // 読めなければ作る前に止める（設定の値で作ると、容量が増えていたときに戻すところで失敗し、作った分の費用もかかる）
  const diskGb = Number(source?.settings?.dataDiskSizeGb);
  if (!Number.isInteger(diskGb) || diskGb <= 0) throw new Error(`共用のインスタンスの容量を読めなかった（${source?.settings?.dataDiskSizeGb}）`);
  cleanup.instance = true;
  runOperation(["sql", "instances", "create", drillName], {
    ...P, region: REGION, "database-version": INSTANCE.databaseVersion, edition: INSTANCE.edition, tier: INSTANCE.tier,
    "availability-type": "zonal", "storage-size": `${diskGb}GB`, backup: false, "deletion-protection": false, "ssl-mode": "ENCRYPTED_ONLY",
  });
  runOperation(["sql", "backups", "restore", before.backupId], { ...P, "restore-instance": drillName, "backup-instance": INSTANCE.name });
  const temp = await CloudSqlProxy.start(`${PROJECT_ID}:${REGION}:${drillName}`, DRILL_PROXY_PORT);
  const after = await (async () => {
    try {
      return await withClient(temp, password, async (client) => ({ restored: await readIds(client, null), photos: await readPhotos(client, before.kept.achievements) }));
    } finally {
      temp.stop();
    }
  })();

  // 5: 判定
  return judgeDrill({ kept: before.kept, restored: after.restored, currentPhotos: before.photos, restoredPhotos: after.photos, bucketFiles });
};

// その場で取ったバックアップ（説明が drillName のもの）の ID。読めなければ投げる
const findDrillBackups = (): string[] => {
  const listed = readJson<{ id: string }[]>(gcloud, ["sql", "backups", "list"], { ...P, instance: INSTANCE.name, filter: `description=${drillName}` });
  if (listed === null) throw new Error("バックアップの一覧を読めなかった");
  return listed.map((b) => b.id);
};

// 6: 一時的なインスタンスとその場のバックアップを消す（成功しても失敗しても。data.md §6）
// 「ない」と「読めなかった」を分ける。読めなければ消せたか分からないので失敗として知らせる
const tearDown = (cleanup: Cleanup): string[] => {
  const failures: string[] = [];
  const attempt = (label: string, action: () => void) => {
    try {
      action();
    } catch (error) {
      failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  if (cleanup.instance) {
    attempt(`一時的なインスタンス ${drillName} を消す`, () => {
      // 一覧を読めなくても名前は分かっているので消しに行く（ないときの失敗も、消せたか分からないので失敗として知らせる）
      const listed = readJson<{ name: string }[]>(gcloud, ["sql", "instances", "list"], { ...P, filter: `name=${drillName}` });
      if (listed === null || listed.length > 0) runOperation(["sql", "instances", "delete", drillName], P);
    });
  }
  // ID が分かっているものを先に消し、そのあと説明で探し直して残りを消す（待っている間に止まって ID を知らなくても消せる）
  const known = cleanup.backupId;
  if (known !== null) attempt(`その場のバックアップ ${known} を消す`, () => runOperation(["sql", "backups", "delete", known], { ...P, instance: INSTANCE.name }));
  if (cleanup.backupStarted) {
    attempt(`その場のバックアップ（${drillName}）を探し直して消す`, () => {
      for (const id of findDrillBackups().filter((id) => id !== known)) runOperation(["sql", "backups", "delete", id], { ...P, instance: INSTANCE.name });
    });
  }
  return failures;
};

type Cleanup = { instance: boolean; backupStarted: boolean; backupId: string | null };
const cleanup: Cleanup = { instance: false, backupStarted: false, backupId: null };
let result: DrillResult | null = null;
try {
  result = await drill(cleanup);
  for (const problem of result.problems) console.error(`❌ ${problem}`);
} catch (error) {
  console.error(`❌ 訓練が途中で止まった: ${error instanceof Error ? error.message : String(error)}`);
}
const leftovers = tearDown(cleanup);
for (const failure of leftovers) console.error(`❌ ${failure}（手で消す）`);
// 片付けに失敗したら、判定が通っていても表には失敗と書く（完了の条件の grep で数えないように）
if (result !== null && leftovers.length > 0) result = { ...result, ok: false };
const row = drillRow(now, c.database, result);
writeFileSync(LOG_FILE, appendRow(readFileSync(LOG_FILE, "utf8"), row));
console.log(`${LOG_FILE} に足した: ${row}`);
process.exit(result?.ok === true && leftovers.length === 0 ? 0 : 1);
