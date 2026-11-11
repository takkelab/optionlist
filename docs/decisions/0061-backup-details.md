# 0061 バックアップの細部（置き場所を東京に、書き出しは作るだけの権限、訓練は表ごとに S′ を見る）

- 日付: 2026-11-11
- 状態: 確定
- 対象: data.md §6、architecture.md §2・§3・§4.1・§4.2、testing.md §2・§6、process.md §5 の R10b

## 決めたこと
- 共用のインスタンスの自動バックアップ（とその場で取るバックアップ）の置き場所を `asia-northeast1` にする（`--backup-location`）。`infra:check -- instance` で確かめる
- 週 1 の書き出しは、本番用のイメージに PostgreSQL 17 の `pg_dump`（Debian の `postgresql-client-17`）を入れ、Node の Job（`src/jobs/backup.ts`）が起動して、出力を `@google-cloud/storage` で入れ物にそのまま流す。接続先は `DATABASE_URL` を分けて `PGHOST`・`PGPASSWORD` などの環境変数で渡す。pg_dump の出力は、終了コード 0 で終わったと分かってから書き込みを閉じ、失敗したら書き込みを壊す（1 回の要求で送るので、途中までのファイルはできない）
- 書き出しのサービスアカウント `optionlist-production-backup` は、入れ物に `roles/storage.objectCreator` だけを持つ。ファイル名は `optionlist_production/<UTC の日時>.dump` で、同じ名前は上書きしない
- 書き出しの Scheduler は、削除のジョブと同じ `optionlist-production-sched` が名乗る（Job ごとの `run.invoker` で絞れているので、名乗るアカウントを増やさない）
- 復旧の訓練の「S′ が空なら失敗」は、表（users・options・achievements）ごとに見る。訓練の前に、その環境に項目・達成・写真を作っておく
- 一時的なインスタンスは、共用のインスタンスと同じ版・エディション・マシンで、容量は共用のインスタンスの今の容量（自動で増えるので設定の値ではなく読んだ値。戻す先は元以上の容量が要る。読めなければ作る前に止める）にし、自動バックアップと削除保護を付けない。インスタンスを消すときに最後のバックアップは取らない（gcloud の既定）。その場で取るバックアップにも `--location=asia-northeast1` を明示する
- 訓練の後片付けは、成功しても失敗しても行う。その場のバックアップは説明（`restore-drill-<日時>`）で探し直して消し（待っている間に止まって ID を知らなくても消せる）、インスタンスは一覧で確かめてから消す。一覧を読めない・消せないときは、判定が通っていても表の結果を `失敗` にする（片付け漏れのまま完了の条件の grep に数えられないように）
- 書き出しの入れ物（`optionlist-backups`）は soft delete を外す（`--clear-soft-delete`）。`infra:check` で 0 であることを確かめる
- ベースイメージは `node:24-trixie-slim`（Debian 13）に固定する。`postgresql-client-17` は Debian の標準のリポジトリでは 13 にしかない
- pg_dump に渡す接続先の環境変数は、空の値を渡さない（libpq は空でも設定ありと読む）
- インスタンスの作成・戻す・消す・バックアップは `--async` で始め、`gcloud sql operations wait --timeout=unlimited` で待つ
- 書き出しのエントリーポイント `backend/src/jobs/backup.ts` も、`cleanup.ts` と同じく L5 の例外（トップレベルの文）に足す（エントリーポイントは終了コードで終わるだけ）
- 写真の入れ物の soft delete は、Cloud Storage の既定（7 日）がもう付いていたが、`infra:setup` で明示し、`infra:check` で確かめる

## 理由
- R10b の確かめで `gcloud sql backups list` を見ると、自動バックアップの `location` が `asia`（マルチリージョン）だった。プライバシーポリシーは「東京リージョン（日本国内の設備）に保存」と書いているので、バックアップも国内にそろえる
- 書き出しの Job を乗っ取られても、前の書き出しを読む・消す・書き換えることができないようにする（35 日の保持はライフサイクルが行う）
- pg_dump を別のイメージにすると、デプロイで差し替えるイメージが 2 つになる。同じイメージに入れれば、本番のデプロイで 1 つのダイジェストを配れる。版が DB より古いと書き出せないので、スモークテストで実際にテスト用 DB を書き出して確かめる
- 表をまとめて見ると、たとえば達成が 1 件もない環境で「達成の ID がすべて戻った」が空のまま成功に見える。写真の食い違いを数える訓練なので、達成と写真がない環境では成功にしない
- 新しい入れ物には Cloud Storage の既定で 7 日の soft delete が付く。書き出しの入れ物に付いたままだと、35 日で消えたあとも 7 日戻せる形で残り、プライバシーポリシーの「バックアップには最長 5 週間残る」を超える（reviewer の指摘）
- `gcloud sql instances create` などは既定で一定の時間しか待たず、時間を過ぎると失敗に見える。訓練が途中で止まると一時的なインスタンスが残り、費用がかかる

## 影響
- イメージが pg_dump の分（十数 MB）大きくなる
- 訓練 1 回で、db-f1-micro のインスタンスを 30 分〜1 時間ほど使う（数十円）
- 残した課題（実害が小さいので今は直さない）: スモークテストは pg_dump を直接流すだけで、`backup.ts` の道筋（接続先の分解と環境変数）はイメージの中で通していない（UT で確かめる）。pg_dump の出力が空のときは、0 バイトのファイルが入れ物に残る（Job は `backup_failed` で失敗し、ファイルは 35 日で消える）。訓練の後片付け（`scripts/restore-drill.ts` の `tearDown`）は gcloud を直接呼ぶので自動のテストがなく、確認用の訓練で実際に流して確かめる。訓練を Ctrl+C で止めると後片付けが流れないので、止めたら `gcloud sql instances list --filter="name:restore-drill-*"` と `gcloud sql backups list --instance takkelab-pg` を見て手で消す
- 既存のインスタンスのバックアップの置き場所を変えると、それ以降のバックアップが東京に置かれる。前からある `asia` のバックアップは、保持の期限（7 回分）で消える
