import { JsonLogger, ProcessLineWriter } from "../infra/JsonLogger";
import { CleanupEntry } from "./CleanupEntry";

// 削除のジョブのエントリーポイント（data.md §5）。確認用・本番は Cloud Run Job（Cloud Scheduler が毎日 4 時〈日本時間〉に動かす）、
// 手元は npm --prefix backend run cleanup。ol_cleanup（CLEANUP_DATABASE_URL）で接続する
// 失敗したら cleanup_failed を出して終了コード 1（Cloud Run Job の実行が失敗になる。アラートは metrics.md §8）
const exitCode = await new CleanupEntry(process.env, new JsonLogger(new ProcessLineWriter())).run();
process.exit(exitCode);
