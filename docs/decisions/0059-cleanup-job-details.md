# 0059 削除のジョブの細部（境目は期限ちょうどを残す、1 本の SQL で消す、Scheduler の名乗り）

- 日付: 2026-11-11
- 状態: 確定
- 対象: data.md §5、architecture.md §2（L5 の例外）・§3・§4.1、testing.md §2・§6、metrics.md §8

## 決めたこと
- 0040 の 5 種類と期限は変えない（R9 の計画のときに見直し、空のアカウントの 30 日も残すことにした）
- 境目は「期限ちょうどは残す」（`<`）。時刻はジョブの開始時に 1 回だけ読む。5 年は暦（`interval '5 years'`）、ほかは 24 時間 × 日数
- アカウントは、写真の名前を読むのと行を消すのを 1 本の SQL（データを変える CTE）で行い、`SELECT … FOR UPDATE` は使わない
- Cloud Scheduler は専用のサービスアカウント `optionlist-<env>-sched`（Job の `run.invoker` だけ）で Cloud Run の API を呼ぶ。Job は流し直さず（`max-retries 0`）、時間の制限は 1 時間
- L5 の例外のエントリーポイントを `backend/src/jobs/*.ts` から `backend/src/jobs/cleanup.ts` に絞る（処理のクラス〈CleanupJob・CleanupRepository〉も jobs/ に置くため）
- イメージのスモークテストで、削除のジョブのコマンドも流す
- Job に `APP_ENV` を渡し、staging・production で `PHOTO_BUCKET` がなければ `cleanup_failed` で止める（組み立ての失敗も含めて、失敗はすべて `cleanup_failed` に出す）
- アカウントの写真で消せなかったものは、同じ実行の「行のない写真」で試し直さない（次の日に拾う）
- 削除のジョブのサービスアカウントの入れ物の権限は、アプリと同じ `roles/storage.objectAdmin` のままにする（使うのは一覧と削除だけだが、カスタムロールを作って保つ手間に見合わない。同じ環境の入れ物だけで、DB の権限とは分かれている）

## 理由
- `FOR UPDATE` は RLS の UPDATE のポリシーを当てる。`ol_cleanup` は UPDATE の権限もポリシーも持たない（data.md §4）ので、行が見えなくなる。GitHub Copilot が途中まで書いた版がこの形で、テストで見つかる前に計画で外した
- 1 本の文にすると、消した人と写真の名前の組が食い違わない（文の外側は文の前の状態を見るので、CASCADE で消える前の achievements が読める）。DELETE の条件は行を消すときに見直されるので、ロックを取らなくても、途中で使い始めた人は消えない
- 期限ちょうどを残すほうが「5 年たったら消す」の読み方に合い、テストで境目を 1 秒単位で確かめやすい
- `optionlist-production-scheduler` はサービスアカウントの ID の上限（30 文字）を超えるので `-sched` にした。起動の権限を削除のジョブのサービスアカウントと分けると、Scheduler の設定を間違えても DB や入れ物には触れない
- 失敗した日に流し直しても、原因（DB に届かないなど）が同じなら同じく失敗する。次の日に流れ、続けて失敗すればアラート（metrics.md §8。R10）で気づく。件数は少ないので、1 時間あれば足りる
- `PHOTO_BUCKET` が抜けると、手元のフォルダ（空）を見て、行は消えるのに入れ物の写真が残り、ログは成功に見える。プライバシーポリシーの「写真も消す」が黙って破れるので、点検（`infra:check`）を待たずに毎回止める
- 同じ実行で試し直すと、ふつうは同じ理由で失敗し、`orphan_file_error` が 1 ファイルで 2 回出てアラートの件数がずれる
- Job は本番用のイメージで動くので、jobs/ がイメージに入っていて、`ol_cleanup` でつないで最後まで流れることを CI で確かめる（確認用で初めて失敗に気づくのを防ぐ）

## 影響
- `backend/src/jobs/`（cleanup.ts・CleanupJob.ts・CleanupRepository.ts）、`PhotoFiles.listOlderThan`、`PhotoRemover.remove` が消せた数を返す、ログの `counts`
- `infra/config.ts`・`infra/setup.ts`・`scripts/lib/infra-checks.ts`・`scripts/infra-check.ts`・`.github/workflows/deploy.yml`・`ci.yml`・`scripts/smoke-image.ts`、`oxlint.config.ts` の L5 の例外
- `CLEANUP_DATABASE_URL` を `.env`・`.env.test`・CI に足す（`db:roles` はもともと読む）
