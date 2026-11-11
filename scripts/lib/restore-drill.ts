// 復旧の訓練（npm run ops:restore-drill。data.md §6。docs/decisions/0041・0061）の判定と、docs/ops/restore-drills.md の行
// 読むのは scripts/restore-drill.ts（gcloud・Proxy・pg）。ここは読んだものを受け取って判定するだけ

export const DRILL_TABLES = ["users", "options", "achievements"] as const;
export type DrillTable = (typeof DRILL_TABLES)[number];
export type IdSets = Record<DrillTable, number[]>;

export type DrillInput = {
  // 3 で読んだ S′（バックアップの直後に、M 以下でまだ残っている ID）
  kept: IdSets;
  // 4 で戻した DB の ID の集合 R
  restored: IdSets;
  // S′ の achievements の photo_filename（3 で読んだ今の DB・戻した DB）。写真のない達成は null
  currentPhotos: Map<number, string | null>;
  restoredPhotos: Map<number, string | null>;
  // 今の写真の入れ物にあるファイルの名前
  bucketFiles: Set<string>;
};

export type DrillResult = { ok: boolean; counts: Record<DrillTable, number>; missingPhotos: number; problems: string[] };

export const judgeDrill = (input: DrillInput): DrillResult => {
  const problems: string[] = [];
  const counts = { users: 0, options: 0, achievements: 0 };
  for (const table of DRILL_TABLES) {
    const kept = input.kept[table];
    counts[table] = kept.length;
    // 空どうしが一致して成功に見えるのを防ぐ（data.md §6 の 3）。表ごとに見る
    if (kept.length === 0) problems.push(`${table}: バックアップの前後に残っていた行がない（S′ が空）`);
    const restored = new Set(input.restored[table]);
    const lost = kept.filter((id) => !restored.has(id));
    // R にしかない ID（新しい行・あとで消えた行）は失敗にしない
    if (lost.length > 0) problems.push(`${table}: 戻した DB にない ID が ${lost.length} 件（${lost.slice(0, 10).join("・")}）`);
  }
  // 「行があるのに写真がない」: 前後で写真が変わっていない S′ の達成で、ファイルが今の入れ物にないもの
  let missingPhotos = 0;
  for (const id of input.kept.achievements) {
    const current = input.currentPhotos.get(id) ?? null;
    const restored = input.restoredPhotos.get(id) ?? null;
    if (current === null || current !== restored) continue;
    if (!input.bucketFiles.has(current)) missingPhotos++;
  }
  if (missingPhotos > 0) problems.push(`行があるのに写真がない達成が ${missingPhotos} 件`);
  return { ok: problems.length === 0, counts, missingPhotos, problems };
};

// 日本時間の年月日と時分（インスタンスの名前と表の日付）
const jst = (now: Date): string => new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString();

// Cloud SQL は消したインスタンスの名前をしばらく使い直せないので、毎回変える（data.md §6 の 4）
export const drillInstanceName = (now: Date): string => `restore-drill-${jst(now).slice(0, 16).replace(/[-T:]/g, "")}`;

// | 日付 | optionlist_<env> | 表ごとの ID の数 | 行があるのに写真がない | 結果 |
export const drillRow = (now: Date, database: string, result: DrillResult | null): string => {
  const date = jst(now).slice(0, 10);
  if (result === null) return `| ${date} | ${database} | - | - | 失敗 |`;
  const counts = DRILL_TABLES.map((table) => `${table} ${result.counts[table]}`).join("・");
  return `| ${date} | ${database} | ${counts} | ${result.missingPhotos} | ${result.ok ? "成功" : "失敗"} |`;
};

// 表の最後に 1 行足す（ファイルの終わりの空行はそろえる）
export const appendRow = (markdown: string, row: string): string => `${markdown.trimEnd()}\n${row}\n`;

// gcloud storage ls gs://<入れ物> の出力（gs://<入れ物>/<名前> の行）からファイルの名前を取り出す
export const bucketFileNames = (bucket: string, listing: string): Set<string> => {
  const prefix = `gs://${bucket}/`;
  return new Set(listing.split(/\r?\n/).filter((line) => line.startsWith(prefix)).map((line) => line.slice(prefix.length)).filter((name) => name !== ""));
};
