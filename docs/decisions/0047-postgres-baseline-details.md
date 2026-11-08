# 0047 Postgres に移るときの細部（fixture の作り方、フルテーブルスキャンの数え方、ID の上限）

- 日付: 2026-11-08
- 状態: 確定
- 対象: process.md §5（R1）、metrics.md §4、data.md §1、testing.md §1

## 決めたこと
- MySQL のダンプと `backend/uploads/` の保存は R1 から外す。手元の MySQL は別の PC にあり、この PC にはない（ユーザーの判断。残すなら、その PC で 0044 の手順を行う）
- `suggestions-mysql-final.json` は、MySQL の実物からではなく、MySQL の最後の提案のマイグレーション（`20261103062438_insert_explore_suggestions.sql`）の INSERT から作った。型も制約もない表を一時的な Postgres の DB に作って up の部分だけを流し、4 つの表を ID 順に JSON にした（一度きりなので、そのスクリプトはリポジトリに入れない）
- フルテーブルスキャン（metrics.md §4）は、`SET LOCAL enable_seqscan = off` にしたトランザクションの中で `EXPLAIN (FORMAT JSON)` を取り、木のどこかにある `Seq Scan` の表を数える。INSERT も含めて全部の SQL を見る
- パスの ID と `suggestionId` の上限は、`INT UNSIGNED`（4,294,967,295）から `Number.MAX_SAFE_INTEGER` にする。日付・日時の年の範囲（1000〜9999 年）は API の制限として残す

## 理由
- fixture: 13 本のマイグレーションのうち、提案の最後の中身を決めるのはこの 1 本だけ（その前の `restructure_suggestions` で旧提案を消し、その後に提案を触るマイグレーションはない）。文字列にバックスラッシュがなく、MySQL と Postgres で同じ値に読める。基準のマイグレーションとは別の経路（元のファイルを素の表に流す）で作るので、写し間違いはテストで見つかる
- enable_seqscan: 性能用データの options は 1,000 行で、`status = 'pending'` の一覧は半分の 500 行を読む。この大きさでは、索引があっても Postgres は全部読むほうが速いと見て Seq Scan を選ぶ。測りたいのは「索引がなく、全部読むしかない SQL」なので、Seq Scan を選べなくしても Seq Scan になるものだけを数える。MySQL の EXPLAIN の `type = ALL` は INSERT でも出たので INSERT を外していたが、Postgres では出ないので外さない
- ID の上限: ID は `BIGINT`（data.md §1）になり、JS で正しく扱える整数ならどれも SQL に渡せる。それより大きい ID の行はできない（identity は 1 から振る）ので、404 のままでよい

## 影響
- `backend/tests/perf/options.perf.test.ts`・`backend/tests/fakes/FullScanFinder.ts`
- `backend/src/controllers/PathId.ts`・`OptionInput.ts`
- process.md §5 の R1 の 1 行目
