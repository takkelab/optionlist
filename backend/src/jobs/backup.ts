import { JsonLogger, ProcessLineWriter } from "../infra/JsonLogger";
import { BackupEntry } from "./BackupEntry";

// 週 1 の書き出しのエントリーポイント（data.md §6）。本番だけの Cloud Run Job（optionlist-production-backup。
// Cloud Scheduler が日曜 5 時〈日本時間〉に動かす）。ol_migrator（DATABASE_URL）で pg_dump し、BACKUP_BUCKET に置く
// 失敗したら backup_failed を出して終了コード 1（Cloud Run Job の実行が失敗になる。アラートは metrics.md §8）
const exitCode = await new BackupEntry(process.env, new JsonLogger(new ProcessLineWriter())).run();
process.exit(exitCode);
