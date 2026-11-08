# 0034 MySQL から Postgres に移り、user_id での絞り込みと RLS を両方使う

- 日付: 2026-11-08
- 状態: 確定
- 対象: SPEC.md §1.2・§1.3、architecture.md §1・§2（L13）、data.md 全体、testing.md、metrics.md §1・§4

## 決めたこと
- DB を PostgreSQL 17 にする。ドライバは `pg`、マイグレーションは今までどおり dbmate
- 利用者のデータの表（users を除く options・achievements）に `user_id` を持たせる。repository の SQL で必ず絞り込み、そのうえで DB の行単位のセキュリティ（RLS）でも他人の行を封じる
- RLS は `current_setting('app.user_id', true)` と比べるポリシーにする。backend は 1 リクエストを 1 つのトランザクションで包み、その中で `SET LOCAL app.user_id` してから SQL を流す（`UserScopedDatabase`。architecture.md §2 L13）
- ロールを分ける。`ol_migrator`（表の持ち主。マイグレーションだけ）、`ol_app`（アプリ。RLS を受ける。BYPASSRLS なし）、`ol_cleanup`（削除のジョブ。0040）、`ol_metrics`（集計のビューだけを読む。0043）、`ol_definer`（ログインしない。鍵から人を探す関数と集計のビューの持ち主）。詳しくは data.md §4
- RLS の中では「鍵から人を探す」ことができない（まだ誰か分からないので）。そこで、人の ID を 1 つだけ返す `SECURITY DEFINER` の関数（`auth_find_user` など）に限って、表を横断させる
- 本番は空から始める（0044）ので、MySQL の 13 本のマイグレーションは Postgres の基準のマイグレーション 1 本にまとめ直す。マスターデータ（提案とテーマ・タグ）もここに入れる

## 理由
- ユーザーは「Postgres のほうが堅牢ならそちらにしたい」と決めた。比べた基準は次の 3 つ
  - 漏れを止める確かさ: RLS なら、SQL に `WHERE user_id` を書き忘れても DB が他人の行を返さない。lint とテストで漏れを止めたうえで、DB 側でもう一重守る
  - 書き換えの量: マイグレーション・生 SQL・CI・性能テストを書き直す。ただ、本番は空から始めるので、既存のデータを移す作業は要らない
  - ホスティング: 管理型の DB は Postgres のほうが選択肢が多い
- RLS には、接続プールで `SET`（`LOCAL` なし）を使うと、別の人の値が残った接続を使い回してすり抜ける、という落とし穴がある。必ずトランザクションの中で `SET LOCAL` を使い、それ以外では DB に触れない形にする（L13 で強制する）
- 行が漏れたときの影響が一番大きいのは写真（顔や場所が写る）なので、写真の配信でも、DB で持ち主を確かめる（0037）

## 影響
- ID は `BIGINT GENERATED ALWAYS AS IDENTITY` にする。連番は推測されても、RLS と 404 で他人の行は読めない（0038）
- `options.suggestion_id` の UNIQUE を (user_id, suggestion_id) に、`sort_order` の「pending の最小値」をユーザーごとに、インデックスを (user_id, …) の複合に直す
- 型を移し替える: `DATETIME(3)` → `timestamptz(3)`、`JSON` → `jsonb`、`ENUM` → `text` ＋ CHECK、`AUTO_INCREMENT` → identity。mysql2 だけの書き方（`INSERT … SET ?`、`?` のプレースホルダ、`ER_DUP_ENTRY`）は、`$1` と SQLSTATE（`23505` など）に直す
- metrics.md §4 の「フルテーブルスキャン」は、`EXPLAIN` の `Seq Scan` で数える
- 0008（MySQL と dbmate の仕組み）の DB に関わる部分は、これで置き換える
