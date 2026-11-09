# 0056 共用の Cloud SQL では、環境ごとのログイン用のロールを作り、ol_* はグループのロールにする

- 日付: 2026-11-09
- 状態: 確定
- 対象: data.md §4、testing.md §7、architecture.md §4.1、process.md §5 の R8

## 決めたこと
- 確認用・本番の `ol_*`（`ol_migrator`・`ol_app` など）は、ログインしないグループのロールにする。権限・ポリシー・持ち主はこれまでどおり `ol_*` に付ける（マイグレーションのファイルは変えない）
- ログインは `ol_<ロール>_<env>` で行う。`ol_app_<env>`・`ol_metrics_<env>` は権限を引き継ぐメンバー、強いロールの `ol_migrator_<env>`・`ol_cleanup_<env>` は `SET ROLE` だけができるメンバーにし、`ALTER ROLE … SET role` でつないだ時点でグループのロールになる
- 各環境の DB の持ち主は、環境ごとのログインしないロール `ol_owner_<env>` にし、誰もそのメンバーにしない。`ol_migrator` には、その DB の `public` スキーマの `USAGE, CREATE WITH GRANT OPTION` だけを付ける
- 各環境の DB の CONNECT は PUBLIC から外し、その環境のログイン用のロール（と管理用のユーザー）にだけ付ける
- `rls-checks.sql` の強いロールへのメンバーシップの例外に、`ol_migrator_<env>`・`ol_cleanup_<env>` の SET だけを足し、`ol_owner_<env>` を強いロールに入れる。ログイン用のロールに表・関数の権限を直接付けていないことの検査を足す

## 理由
- 0035 は「環境ごとに DB とロールを分ける」としたが、ロールはインスタンス全体で共通なので、同じ `ol_app` を使うと確認用と本番でパスワードも同じになる。0055 で、main への push で動く確認用と、自分が起動する本番の権限を分けた。確認用の秘密の値が漏れたとき（確認用のデプロイ用のサービスアカウントが乗っ取られたときなど）に、本番の DB に入れてしまうと、その分けた意味がなくなる
- インスタンスを 2 台にする案は、月の費用がおよそ 2 倍（4,000 円前後）になり、0035 の 3,000 円を超える
- ロールの名前を環境ごとに変える案は、マイグレーションの中の `TO ol_app` などを環境ごとに書き換えることになる。グループのロールにすれば、手元・CI・確認用・本番で同じマイグレーションを流せる
- 手元の PostgreSQL 17 で、superuser でないロール（Cloud SQL の `postgres` と同じく CREATEROLE・CREATEDB だけ）を使って確かめた: `ALTER ROLE … SET role` でつないだ時点で `current_user` がグループのロールになり、作った表の持ち主もグループのロールになる。`SET ROLE ol_definer` も（SET のメンバーシップをたどって）でき、`RESET ROLE` はグループのロールに戻る
- DB の持ち主を `ol_owner_<env>` にするのは、reviewer の指摘による。DB の持ち主と権限はクラスタ全体の `pg_database` にあるので、両方の環境で `ol_migrator` を持ち主にすると、確認用の DB につないだ `ol_migrator_staging`（つないだ時点で `ol_migrator`）から `GRANT CONNECT ON DATABASE optionlist_production …`・`DROP DATABASE optionlist_production` が通る。マイグレーションが持ち主の権限を使うのは `public` スキーマの GRANT・REVOKE だけなので、スキーマの権限を GRANT OPTION つきで渡せば足りる。手元（superuser でないロール）と確認用の Cloud SQL の両方で、マイグレーションがすべて通ること、`ol_migrator_staging` からの DB の GRANT・RENAME・`SET ROLE ol_owner_staging` が拒まれることを確かめた

## 影響
- `RoleSetup` に `--env staging|production`（`npm --prefix backend run db:roles:cloud`。`--env` を付け忘れたら止まる）。superuser でなくても通るように、属性は今の値と違うものだけを書き、`CREATE DATABASE … OWNER` と DB・`public` スキーマの権限の付け替えの間だけ `ol_owner_<env>` への SET を自分に付けて外す
- `rls-checks.sql` と `tests/migrations/rls.test.ts`（ログイン用のロールを作った形で違反 0 件、誤った形で見つかる）、`tests/unit/role-setup.test.ts`
- `infra:check` で、各環境の DB の持ち主・CONNECT と、グループのロールにログインできないことを確かめる
