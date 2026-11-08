# 0008 DB とマイグレーションの仕組み（ステップ 2）

- 日付: 2026-11-01
- 状態: 一部置き換え（DB は MySQL から Postgres へ。→ 0034）
- 対象: data.md §1、testing.md §0・§1、architecture.md §2（L5 の例外）

## 決めたこと
- 接続先を `DB_HOST` などの 5 つの変数から `DATABASE_URL` 1 つにした。dbmate は npm パッケージ（backend の devDependency）で入れる
- テスト用 DB のマイグレーションは vitest の globalSetup ではなく、npm scripts（`test` の前の `db:migrate:test`）で流す
- マイグレーションテストは別の DB（`<テスト用 DB 名>_migrations`）で行い、backend のテストファイルは並列に流さない（`fileParallelism: false`）
- 性能用データ生成のエントリーポイント `backend/db/perf-data/generate.ts` を、`server.ts` と同じく L5 のトップレベルの文の例外にした
- 索引は初期値として options (status, sort_order)、notes (option_id, created_at)、achievements (option_id, achieved_at)・(achieved_at)、events (occurred_at) を張った

## 理由
- dbmate は `DATABASE_URL` しか読まない。変数を分けたままだと、dbmate 用に URL を組み立てるスクリプトが要るうえ、同じ接続先を 2 か所に書いてずれる。mysql2 も `uri` で同じ URL を受け取れる
- dbmate を npm で入れれば `npm install` だけで Windows でも CI でも同じ版が入り、手で入れる手順が要らない（process.md §2 の優先順位 1）
- globalSetup は関数を export する必要があり L5 に当たる。npm scripts なら例外を増やさずに済む
- マイグレーションテストは DB を drop して作り直すので、API テストが使う DB とは分ける。API テストは同じ DB を空にしてから使うため、ファイルを並列に流すと互いのデータを消し合う
- 性能用データはデータを消してから入れるので、DB 名が `_test` で終わらなければ止める（開発用 DB の実データを守る）
- 索引はステップ 3 の EXPLAIN（フルスキャン 0 件、metrics.md §4）で見直す前提で、一覧・詳細・集計で使う列に張った

## 影響
- `backend/.env`・`.env.test` を `DATABASE_URL` に書き換える必要がある（`.env.example`・`.env.test.example` 参照）
- CI は env の `DATABASE_URL` から `backend/.env.test` を作ってマイグレーションする
- `npm run metrics:check` が `migration-test-failures`（metrics.md §2）を計測する
