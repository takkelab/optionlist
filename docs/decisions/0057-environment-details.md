# 0057 確認用・本番の環境の細部（独自ドメインは R11 で、マイグレーションの Job、ログの置き場所、infra のスクリプト）

- 日付: 2026-11-09
- 状態: 一部置き換え（独自ドメインと `APP_ORIGIN` → 0063。確認用・本番は Cloud Run の URL ではなく `staging.optionlist.app`・`optionlist.app`）
- 対象: SPEC.md §3、architecture.md §4、data.md §4、process.md §5 の R8・R11

## 決めたこと
- 独自ドメインはまだ決めない。R8 では確認用・本番を Cloud Run の URL（`https://optionlist-<env>-55327626788.asia-northeast1.run.app`。`APP_ORIGIN` もこれ）で動かし、ドメインを決めてつなぐのは R11 の 1 段目より前にする
- マイグレーションの Job は、出すものと同じイメージで `dbmate --no-dump-schema --migrations-dir db/migrations migrate` を流す。イメージに dbmate（公式のイメージから実行ファイルだけ。版は backend/package-lock.json と同じ）とマイグレーションのファイルを入れる。`migrate` は DB を作らないので、確認用・本番の `ol_migrator` に CREATEDB を付けない（0048 で R8 に回したもの）。Job はやり直さない（`max-retries` 0）
- 共用の Cloud SQL は `takkelab-pg`。PostgreSQL 17 は何も書かないと Enterprise Plus になって共有コアを選べないので、`--edition=ENTERPRISE --tier=db-f1-micro` にする。承認済みのネットワークは置かず、`ssl-mode=ENCRYPTED_ONLY`。手元からは Cloud SQL Auth Proxy（`--gcloud-auth`）でつなぐ
- 接続先の URL は、パスワードを含めて丸ごと Secret Manager に置く（Unix ソケットの形。2 回目からの `infra:setup`・`infra:check` はここからパスワードを読む）。秘密の値は東京に置く（`--locations=asia-northeast1`）
- アクセスのログは、`_Default` のシンクの行き先を東京のログのバケット（`default-asia-northeast1`、30 日）にして国内に置く。プライバシーポリシーの「預け先」は変えない
- Workload Identity Federation は、プロバイダの条件を `repository_id`・`repository_owner_id`、属性 `deploy_target` を `workflow_ref`・`event_name` から作り（push → `staging`、workflow_dispatch → `production`、ほか → `none`）、各環境のデプロイ用のサービスアカウントにその値の principalSet だけを入れる
- サービスと Job の設定（サービスアカウント、秘密の値、台数、Cloud SQL）は `infra:setup` が決め、`deploy.yml` はイメージだけを差し替える。最初は Google のサンプルのイメージで作る。台数はサービスの単位（`--min`・`--max`）とリビジョンの単位（`--min-instances`・`--max-instances`）の両方を決めた値にする（サービスの単位だけ 3 になっていたのを `infra:check` で見つけた）
- `deploy.yml` は、main のコミットのイメージを CI と同じ `Dockerfile` で 1 回だけ作る（CI の `image` ジョブは PR のコミットで作るので、そのイメージは使わない）。出したあと `update-traffic --to-latest` で 100% を新しいリビジョンに移し、100% を受けているイメージが出したダイジェストと同じかを確かめる。本番のジョブが確認用のイメージを読むのも、サービスの describe（100% のリビジョンが最新の Ready のリビジョンのときのテンプレートのイメージ）だけで行い、revisions API は使わない（本番のデプロイ用のサービスアカウントに付けるのは、確認用のサービスの `run.viewer` だけなので）
- `infra/` のスクリプトは node（TypeScript）で書き、gcloud の値のあるフラグは `--flags-file`（JSON の一時ファイル）で渡す。`scripts/`・`tools/` と同じく運用の道具なので、lint の設計ルール（architecture.md §2）の対象外にする（0005）。型チェックには入れる

## 理由
- ドメイン: ユーザーがまだ持っていない。Cookie（`__Host-`）とホーム画面のアプリはオリジンごとなので、自分のデータを作り始める R11 の 1 段目より前に決めればよい
- 同じイメージで流すのは、確認用で確かめたマイグレーションとアプリの組を、そのまま本番に出すため（0036）。別のイメージにすると、本番で流すマイグレーションが確認用と違いうる
- Unix ソケットの URL（`postgres://u:p@/db?host=/cloudsql/…`）は、pg と dbmate のどちらも読めることを確かめた。Node の `URL` はホストの空の URL を読めないので、infra のコードでは文字列で組み立てる
- ログ: 0052 で「国内に置けなければポリシーを直す」とした。Cloud Logging のバケットは asia-northeast1 に作れる。`_Required`（管理の監査ログ）は場所を変えられないが、利用者のアクセスのログは入らない
- deploy_target: principalSet には属性を 1 つしか書けないので、workflow_ref と event_name を 1 つの属性にまとめる。リポジトリ名ではなく ID で縛る（0055）
- flags-file: Windows の gcloud は gcloud.cmd で cmd.exe を通るので、CEL の式の `'`・`&&`・`|` が壊れる。パスワードも画面とコマンドラインに出ない

## 影響
- `infra/config.ts`・`infra/setup.ts`（`npm run infra:setup`）・`scripts/infra-check.ts`（`npm run infra:check`）と、判定のテスト（`scripts/tests/infra-checks.test.ts`）、`deploy.yml` と `infra/config.ts` の値の照らし合わせ（`scripts/tests/deploy-workflow.test.ts`）
- `Dockerfile` に dbmate とマイグレーションのファイル。`smoke:image` がイメージの中の dbmate で `migrate` を流す（`DATABASE_URL` が要る）
- process.md の `<確認用のドメイン>`・`<本番のドメイン>` は、R11 まで Cloud Run の URL。R11 に独自ドメインをつなぐ項目と条件を足した
