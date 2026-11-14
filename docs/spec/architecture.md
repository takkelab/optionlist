# 技術スタック・コード設計ルール・フォルダ構成

[SPEC.md](../../SPEC.md) の一部。「※仮決め」の項目は実装しながら変えてよい（変えたら docs/decisions/ に記録する）。

## 1. 技術スタック

| 領域 | 採用 | 備考 |
|------|------|------|
| frontend | React 19 + TypeScript 7 + Vite | 雛形どおり |
| ルーティング | React Router | |
| 通信 | axios | `frontend/src/api/` 経由のみ |
| スタイル | CSS Modules ＋ デザイントークン（CSS 変数） | 色・文字サイズ・余白は `styles/tokens.css` にだけ書く。テーマは白いカードに色みのない灰色の背景、アクセントはティール（ライトのみ）。差し色にアイコンの虹の輪から取った装飾の色を、縁にだけ使う（docs/decisions/0024） |
| アイコン | インライン SVG（`components/Icon.tsx`） | アイコンのライブラリは入れない |
| 並び替え | dnd-kit | react-beautiful-dnd は開発終了のため使わない |
| アニメーション | Motion | |
| backend | Express 5 + TypeScript | 雛形どおり |
| PWA | vite-plugin-pwa | 画面の殻だけをキャッシュし、`/api` はキャッシュしない（docs/decisions/0032） |
| DB | PostgreSQL 17 | RLS で他人の行を封じる（data.md §4。docs/decisions/0034） |
| DB アクセス | pg（node-postgres）で生 SQL | 必ずプレースホルダ（`$1`）を使う。利用者のデータは `UserScopedDatabase` 越しにだけ触る（§2 の L13） |
| マイグレーション | dbmate | 生 SQL で up / down。本番では up だけ（data.md §1） |
| アカウント | 自前の匿名アカウント（Cookie ＋ 復旧コード） | 認証のサービスやライブラリは使わない（api.md §6。docs/decisions/0033） |
| 画像受信 | multer ＋ sharp | sharp で作り直してメタデータを消す（api.md §5。docs/decisions/0037） |
| 写真の保存 | `@google-cloud/storage`（確認用・本番）、ローカルのフォルダ（手元・CI） | `PhotoFiles` の実装で切り替える |
| 実行時メトリクス | prom-client ＋ Cloud Monitoring | `/api/metrics` はトークンがないと 404（docs/decisions/0042） |
| テスト | Vitest + supertest（API・統合）、Vitest（UT）、Playwright（E2E） | カバレッジは `@vitest/coverage-v8` |
| lint | oxlint ＋ 自作ルール（JS プラグイン） | 雛形どおり。backend にも入れる。自作ルールは `tools/lint-rules/` に置く |
| CI | GitHub Actions | PostgreSQL 17 はサービスコンテナで用意する |
| 実行環境 | Cloud Run（asia-northeast1）＋ Cloud SQL for PostgreSQL ＋ Cloud Storage | §4。docs/decisions/0035 |

## 2. コード設計ルール（lint で強制する）
きれいに設計しないと lint もテストも通らない状態にして、AI が書くコードを縛る。
目的は「依存をインタフェース越しに差し替えられる小さなクラス」に寄せること。そうすれば、モックを使わずにフェイクで単体テストが書ける。

| # | ルール | 内容 | 例外 |
|---|--------|------|------|
| L1 | ファイルの行数上限 | 200 行以内（空行・コメントを除く）※仮決め | テストファイルは 300 行以内。マイグレーションの SQL は対象外 |
| L2 | 関数の行数上限 | 40 行以内 ※仮決め | React コンポーネント（`.tsx` の関数）は 80 行以内。テストファイル（`*.test.ts(x)`、e2e の `*.spec.ts`）は対象外（`describe` の中身はケースの並びで長くなるため）。フェイクは対象 |
| L3 | 影響範囲の広いモックの禁止 | `vi.mock` / `vi.doMock` / `vi.stubGlobal` / モジュールや組み込みオブジェクト（ファイル内で宣言していない名前）への `vi.spyOn`、E2E での `page.route`（`routeFromHAR`・`routeWebSocket` を含む）を禁止。依存はコンストラクタで受け取り、テストではインタフェースを実装したフェイクを渡す | なし |
| L4 | デメテルの法則 | 「先の先」をたどらない。`this.repo.find()`（自分のフィールドのメソッド）や `option.title` はよいが、`a.b.c` / `a.b.c()` のように 2 段以上たどるのは禁止。段数は根元から数え、`this` と自分のフィールド（`this.x`・`this.#x`）は 0 段目、呼び出しの戻り値に続くアクセスも 1 段に数える（`a.b().c`・`(await a.b()).c` は違反）。型情報は使わず名前で判定する | 戻り値に続くメンバーのうち、許可リストにあるもの（配列・文字列・Promise のメソッドと `length`、Express の `res.status().json()`）。`process.env.X`、`import.meta.env.X`、名前空間 import の `ns.x`、Vitest の `expect(x).not` / `resolves` / `rejects`。許可リストは `tools/lint-rules/rules/law-of-demeter.ts` |
| L5 | トップレベル関数の禁止 | `function` 宣言も、トップレベルの変数に入れたアロー関数（オブジェクトの値や `asyncHandler(…)`・`Router().get(…)` のような呼び出しの引数に入れたものを含む。`items.map(…)` など配列・Promise のメソッドに渡すものは除く）も禁止。宣言以外のトップレベルの文（`router.get(…)` など）も禁止。処理はクラスのメソッドに書く | frontend の React コンポーネント（大文字で始まる、`.tsx` 内）とフック（`useXxx`）。エントリーポイント（`server.ts`、`main.tsx`、`backend/src/jobs/cleanup.ts`・`backup.ts`）とテストのトップレベルの文（テストでも関数は禁止。使い回す処理はフェイクのクラスにする） |
| L6 | インタフェースのないクラスの禁止 | すべてのクラスは `implements` で 1 つ以上のインタフェースを実装する | `Error` を継承したエラークラス |
| L7 | static の禁止 | `static` のメソッド・プロパティ・ブロックを禁止。モジュールのトップレベルの `let`（実質的な static 変数）も禁止 | なし |
| L8 | パブリック変数の禁止 | クラスのプロパティは `private`（または `#`）のみ。外から値を読む必要があればメソッドで返す。`export let` も禁止 | なし |
| L9 | 継承の禁止 | `extends` は許可リストにあるクラスだけ | `Error` |
| L10 | any の禁止 | `any`、`as any`、`as unknown as`、`@ts-ignore`、`@ts-expect-error` を禁止 | なし |
| L11 | lint 無効化コメントの禁止 | `oxlint-disable` などで lint を止めることを禁止。ルールに合わない正当な理由があるときは、ルール側の例外として許可リストに追加し、PR で理由を書く。lint ではなく `npm run metrics:check` が全体（scripts・tools を含む）を見る | なし |
| L12 | `shared/` に実行コードを置かない | `shared/` には `type` / `interface` だけを書く。frontend・backend からは `import type` で読む（`import { type X }` は実行時に import が残るので不可） | なし |
| L13 | 利用者のデータには `UserScopedDatabase` 越しにだけ触る | backend の SQL の文字列（テンプレートリテラルと、文字列の `+` の連結を含む）に、利用者のデータの表（`users`・`options`・`achievements`）の名前が `FROM`・`JOIN`・`INTO`・`UPDATE` の後（`public.` や引用符が付いたもの、`FROM` のコンマの並びを含む）に出てくるファイルは、`UserScopedDatabase` を受け取るクラスでなければならない（生の `Database` を import しない）。`UserScopedDatabase` は `Database.forUser(userId \| null)` だけが作り、`run(fn)` の中で `BEGIN` → `set_config('app.user_id', …, true)`（null なら設定しない）→ fn → `COMMIT` を行う。`pg` を import してよいのは `backend/src/infra/` だけ。`set_config`・`SET` を SQL に書いてよいのも `infra/` だけ | 許可リスト（`tools/lint-rules/rules/user-scoped-db.ts`）: `AccountRepository`（data.md §4 の認証の関数だけを呼ぶ）、`HealthRepository`（`SELECT 1` だけ）、`EventRepository`（events への INSERT だけ）、`backend/src/jobs/`（`ol_cleanup` で接続する削除のジョブ）。提案の repository は options を JOIN する（追加済みかを出す）ので、許可リストに入れない |

- 対象はアプリのコード（backend・frontend・shared・e2e）。scripts/ と tools/ は品質チェックのためのハーネスなので L1〜L10・L12・L13 の対象外
- L13 は、他人のデータが見えないことを確かめる 3 つの仕組みの 1 つ。残りの 2 つ（DB の設定と、API の振る舞い）は testing.md §7（docs/decisions/0046）
- oxlint の標準ルールで書けるもの（L1・L2・L10 など）は標準ルールを使い、それ以外は自作ルールにする。どのルールが §2 に当たるかは `tools/lint-rules/design-rules.ts`、ファイルごとの例外は `oxlint.config.ts` に書く
- **自作ルールにもテストを書く**（違反を検出する例と、例外として通す例の両方）。`tools/lint-rules/rules/<名前>.ts` に対して `tools/lint-rules/tests/<名前>.test.ts` を置き、RuleTester の `valid`（例外）と `invalid`（検出）を 1 件以上書く

## 3. フォルダ構成

```
optionlist-web/
├── SPEC.md                   # 入口（概要・スコープ・目次・未決事項）
├── CLAUDE.md                 # コマンド・Gotchas。禁止事項は lint で止められないものだけ書く
├── metrics.config.json       # 目標値（唯一の正。metrics.md と同時に更新する）
├── oxlint.config.ts          # lint の設定（§2 のルールとファイルごとの例外）
├── .claude/                  # settings.json（権限・フック）、rules/、agents/
├── .github/
│   ├── workflows/ci.yml
│   └── pull_request_template.md   # 「詰まった点と再発防止策」欄
├── docs/
│   ├── spec/                 # SPEC の各章
│   ├── decisions/            # 仮決め・目標値の確定と変更（process.md §3）
│   ├── harness/incidents.md  # AI が詰まった記録（process.md §2）
│   ├── metrics/ai-usage.md   # metrics.md §7 の記録
│   ├── ops/                  # 運用の記録（復旧の訓練、中身を見た記録、公開のチェックリスト。metrics.md §8）
│   └── reference/            # 旧仕様書
├── Dockerfile                # 本番用のイメージ（frontend をビルドし、Express が画面も配る。§4）
├── infra/                    # Google Cloud の環境を作る gcloud のスクリプトと、設定の確かめ（infra:check。§4）
├── tools/lint-rules/         # 自作 lint ルール（rules/）＋そのテスト（tests/）、§2 のルール一覧（design-rules.ts）
├── scripts/                  # 品質チェック、metrics:check、metrics:usage、ops:restore-drill
├── shared/
│   └── types.ts              # api.md §4 の型（型だけ。L12）
├── backend/
│   ├── db/
│   │   ├── migrations/       # dbmate（up/down、マスターデータを含む）
│   │   ├── schema.sql        # dbmate が自動で書き出す。手で編集しない
│   │   └── perf-data/        # metrics.md §1 の性能用データの生成
│   ├── src/
│   │   ├── server.ts         # エントリーポイント。DB の接続などを作って AppAssembly に渡し、listen する
│   │   ├── AppAssembly.ts    # controllers・services・repositories を new して注入する（テストの TestApp も同じものを使うので、分離テストが集めるルートは本番と同じ）
│   │   ├── jobs/             # Cloud Run Job。削除のジョブのエントリーポイント cleanup.ts と、その処理（CleanupJob）・SQL（CleanupRepository。ol_cleanup で全員の行を扱うので repositories/ に置かない。§2 の L13）。data.md §5。週 1 の書き出しの backup.ts（BackupJob。pg_dump は infra/PgDump、入れ物は repositories/GcsBackupFiles）。data.md §6
│   │   ├── app.ts            # Express の設定（クラス。supertest はこれを使う）
│   │   ├── controllers/      # ルーティング・入力検証・レスポンス
│   │   ├── services/         # 処理（並び順、完了、提案の関連の順番、アカウントと復旧コード、メモリで数える回数の制限など）
│   │   ├── repositories/     # SQL はここだけ。snake_case ↔ camelCase の変換もここ。写真のファイルの置き場所（LocalPhotoFiles・GcsPhotoFiles）もここ
│   │   ├── middleware/       # エラーハンドラ、multer、リクエスト計測、セッション、Origin の確認、回数の制限、セキュリティのヘッダー、画面の配信
│   │   ├── metrics/          # prom-client の定義
│   │   └── infra/            # DB 接続（pg のプール、TimeZone=UTC、UserScopedDatabase、クエリ計測ラッパー）、JSON のログ、環境変数の読み取り（AppConfig）
│   ├── tests/
│   │   ├── unit/             # フェイクだけで動くテスト（UT カバレッジの対象）
│   │   ├── api/              # supertest＋テスト用 DB
│   │   ├── migrations/       # マイグレーションのテスト
│   │   ├── perf/             # 性能の統合テスト
│   │   └── fakes/            # テスト用のフェイク実装
│   └── uploads/              # .gitignore 対象。テストは UPLOAD_DIR で別フォルダ
├── frontend/src/
│   ├── main.tsx              # エントリーポイント
│   ├── app/                  # ルーティング、Context（依存の注入）
│   ├── api/                  # axios はここ経由のみ（クラス）
│   ├── features/
│   │   ├── options/          # list/ done/ completion/ と、カードのシート
│   │   ├── suggestions/
│   │   ├── account/          # 設定のシート、復旧コードの発行・入力、すべてのデータを消す（screens.md §9）
│   │   └── legal/            # プライバシーポリシー・利用規約のページ（screens.md §10）
│   ├── components/           # TabBar, Toast, ConfirmDialog など共通 UI
│   ├── lib/                  # 画像の縮小、日付の整形など（クラス＋UT）
│   └── styles/tokens.css     # 色・文字サイズ・余白はここだけ
└── e2e/                      # Playwright（設定・テスト・ページオブジェクト。依存はルートの package.json）
```

### 3.1 層と依存の向き
- backend: `controllers → services → repositories → infra`。逆向きの依存は禁止。各層はインタフェース越しに次の層を使い、具体的なクラスを `new` するのは `server.ts`・`AppAssembly.ts`・`jobs/*.ts`（とテスト）だけ
- セッションの middleware は、Cookie から人を決めるために services の `SessionResolver` インタフェースだけを `import type` で読んでよい（層の lint の例外。中身は `AccountService` が実装し、`server.ts` が渡す）。決めた人の ID は `res.locals` に入れ、controllers が services に引数で渡す（services は Express を知らない）
- frontend: `features / components → app の Context → api・lib`。コンポーネントから axios や `fetch` を直接呼ばない
- `shared/types.ts` はどこから読んでもよい
- 層の向きも lint で確かめる。backend は `oxlint.config.ts` の `no-restricted-imports`（層のフォルダごとに、上の層と飛び越し先を禁止。middleware・metrics は controllers・services・repositories・infra を読まない）。テストは `tools/lint-rules/tests/layer-imports.test.ts`。`services/errors.ts`（`AppError`）だけはどの層から読んでもよい。frontend は同じ `no-restricted-imports` で、`features/`・`components/` から `api/` と `axios` を、`api/`・`lib/` から `app/`・`features/`・`components/` を読めないようにする

### 3.2 置き場所の決め方
- 1 つの画面でしか使わないものは `features/` の中、2 つ以上で使うものは `components/` や `lib/` へ
- `options/done/` は「やった」画面。扱うデータは options と同じなので `features/options/` の中に置く

## 4. 環境とデプロイ（docs/decisions/0035・0036）

### 4.1 環境
| 環境 | 動かす場所 | DB | 写真 | 出し方 |
|------|------------|----|------|--------|
| 手元 | Windows（`npm run dev`） | Windows に直接入れた PostgreSQL 17 | `LocalPhotoFiles` | — |
| CI | GitHub Actions | `postgres:17` のサービスコンテナ | `LocalPhotoFiles`（一時フォルダ）。`GcsPhotoFiles` のテストは fake-gcs-server | push・PR ごと |
| 確認用 | Cloud Run `optionlist-staging`（最小 0 台・最大 2 台）。`https://staging.optionlist.app`（ドメインマッピング。docs/decisions/0063） | 共用の Cloud SQL の `optionlist_staging` | Cloud Storage `optionlist-staging-photos` | main に入ったら自動 |
| 本番 | Cloud Run `optionlist-production`（最小 0 台・最大 3 台）。`https://optionlist.app`（ドメインマッピング。DNS は Cloudflare でプロキシなし。docs/decisions/0063） | 共用の Cloud SQL の `optionlist_production` | Cloud Storage `optionlist-production-photos` | 自分が `deploy.yml` を手で起動したとき（`workflow_dispatch`。docs/decisions/0055） |

- 地域はすべて `asia-northeast1`（東京）。API と DB を同じ地域に置く
- 確認用と本番は、同じイメージ（同じダイジェスト）を出す。イメージは main に入ったときに 1 回だけ作り、Artifact Registry に置く
- GitHub Actions から Google Cloud へは Workload Identity Federation で入る（サービスアカウントの鍵を置かない）。デプロイ用のサービスアカウントは、`repository_id`・`repository_owner_id`・`workflow_ref`（`deploy.yml` の main）と `event_name` で縛り、確認用は `push`、本番は `workflow_dispatch` のときにしか使えないようにする。本番には、確認用の Cloud Run でトラフィックを 100% 受けているリビジョンのイメージをダイジェストで出す。そのため本番のデプロイ用のサービスアカウントは、確認用の Cloud Run サービスと Artifact Registry の読み取りだけを、環境をまたいで持つ。`GITHUB_TOKEN` の既定の権限は読み取りだけにし、どのワークフローにも `actions: write`・`write-all` を与えない（docs/decisions/0055）
- 出す前に、Cloud Run Job（`optionlist-<env>-migrate`）で `ol_migrator` としてマイグレーションを流す。失敗したら、新しいイメージは出さない。Job は、出すものと同じイメージ（同じダイジェスト）で `dbmate --no-dump-schema --migrations-dir db/migrations migrate` を流す（DB を作らない。やり直さない。docs/decisions/0057）
- 共用の Cloud SQL は `takkelab-pg`（PostgreSQL 17、Enterprise の db-f1-micro）。Cloud Run からは Unix ソケット（`--add-cloudsql-instances`）でつなぎ、手元（`infra:setup`・`infra:check`）からは Cloud SQL Auth Proxy でつなぐ。承認済みのネットワークは置かず、暗号化した接続だけを受け付ける。DB のログイン用のロールは環境ごとに分ける（data.md §4。docs/decisions/0056）
- アクセスのログ（Cloud Run のリクエストのログ）は、`_Default` のシンクの行き先を東京（asia-northeast1）のログのバケットにして、国内に置く（docs/decisions/0052・0057）
- Cloud Run のサービスアカウントは環境ごとに分け、自分の環境の入れ物・秘密の値・Cloud SQL の接続だけを許す
- 削除のジョブ（data.md §5）は Cloud Run Job `optionlist-<env>-cleanup`（本番用のイメージで `node --import tsx --max-semi-space-size=4 src/jobs/cleanup.ts`、流し直さない、時間の制限 1 時間。`APP_ENV`・`PHOTO_BUCKET` を渡し、`APP_ENV` が staging・production で `PHOTO_BUCKET` がなければ止まる）。サービスアカウント `optionlist-<env>-cleanup` は、Cloud SQL の接続・写真の入れ物・`CLEANUP_DATABASE_URL` の秘密の値だけを持つ。Cloud Scheduler `optionlist-<env>-cleanup-daily` が毎日 4 時（Asia/Tokyo）に Cloud Run の API（`jobs/…:run`）を呼んで起動する。名乗るサービスアカウント `optionlist-<env>-sched` は、その Job（本番は書き出しの Job も）の `run.invoker` だけを持つ。Job のイメージは、`deploy.yml` がマイグレーションの後に差し替える。`infra:check` は Job の設定・IAM と Scheduler（ENABLED、毎日 4 時）も確かめる
- 週 1 の書き出し（data.md §6。本番だけ）は Cloud Run Job `optionlist-production-backup`（本番用のイメージで `node --import tsx --max-semi-space-size=4 src/jobs/backup.ts`、流し直さない、時間の制限 1 時間。イメージに PostgreSQL 17 の `pg_dump` を入れる。`DATABASE_URL` はマイグレーションの Job と同じ秘密の値、`BACKUP_BUCKET=optionlist-backups`）。サービスアカウント `optionlist-production-backup` は、Cloud SQL の接続・その秘密の値・入れ物 `optionlist-backups` への作成（`objectCreator`）だけを持つ。Cloud Scheduler `optionlist-production-backup-weekly` が日曜 5 時（Asia/Tokyo）に、削除のジョブと同じ `optionlist-production-sched` を名乗って起動する。Job のイメージは本番のデプロイで差し替える。入れ物は東京・非公開で、35 日で消えるライフサイクルだけを持つ（soft delete は付けない）
- 環境の設定は `infra/` の gcloud のスクリプト（`npm run infra:setup -- <apis|instance|shared|db <env>|domain <env>|env <env>>`。何度流しても同じ結果になる。`domain` は独自ドメインのマッピングで、所有の確認のあと・DNS と証明書の前に流し、`env` は証明書が出てから流す。docs/decisions/0063。名前と値は `infra/config.ts`）で作り、`npm run infra:check -- <instance|staging|production>` で決めたとおりかを確かめる。`instance` は共用の Cloud SQL のインスタンス（地域、削除保護、自動バックアップと時点復旧、インスタンスを消してもバックアップを残す設定、バックアップの置き場所が東京。バックアップはインスタンス全体が単位なので、環境ごとではなくここで見る。data.md §6）。`staging`・`production` はその環境（Cloud Run の台数〈サービスの単位とリビジョンの単位の両方〉、入れ物の公開アクセスの防止と soft delete（7 日）、本番では書き出しの Job・Scheduler・入れ物と IAM〈R10b から〉、秘密の値の置き場所、サービスアカウントの権限、DB の持ち主と CONNECT、デプロイ用のサービスアカウントの Workload Identity Federation の条件と、本番のデプロイ用のサービスアカウントの確認用への権限が読み取りだけであること、ロールに BYPASSRLS がないこと、監視〈通知先のメールが gcloud にログインしているアカウントであること、死活監視〈host が独自ドメイン〉とアラートのポリシー、本番ではログの指標と予算。R10c から。docs/decisions/0062〉、独自ドメイン〈マッピングがそのサービスを指し、Ready・CertificateProvisioned・DomainRoutable が True で、DNS がマッピングの出したレコードだけを返す。R11a から。docs/decisions/0063〉）。`staging`・`production` では、`GITHUB_TOKEN` の既定の権限が `read` で、main の `.github/workflows/` に `actions: write`・`write-all` がないことも確かめる（docs/decisions/0055）。`instance` では、あわせてアクセスのログの行き先（東京のバケット）と、管理用のパスワードの秘密の値に誰の権限も付いていないことを確かめる（docs/decisions/0057）

### 4.2 環境変数と秘密の値
| 名前 | 内容 | 置き場所（確認用・本番） |
|------|------|--------------------------|
| `PORT` | 待ち受けるポート | Cloud Run が入れる |
| `APP_ENV` | `development` / `test` / `staging` / `production` | Cloud Run の環境変数 |
| `APP_ORIGIN` | 自分のオリジン（`https://…`。Origin の確認に使う） | Cloud Run の環境変数 |
| `APP_DATABASE_URL` | `ol_app` での接続先（確認用・本番は `ol_app_<env>`。`postgres://ol_app_<env>:…@/optionlist_<env>?host=/cloudsql/<接続名>&sslmode=disable`） | Secret Manager |
| `DATABASE_URL` | `ol_migrator` での接続先（マイグレーションの Job と、本番の書き出しの Job だけ。確認用・本番は `ol_migrator_<env>` で、同じ形） | Secret Manager |
| `CLEANUP_DATABASE_URL` | `ol_cleanup` での接続先（削除のジョブだけ） | Secret Manager |
| `METRICS_DATABASE_URL` | `ol_metrics` での接続先（`npm run metrics:usage` だけ。手元から使う。metrics.md §6） | Secret Manager の `optionlist-<env>-metrics-database-url`（形は `APP_DATABASE_URL` と同じ。`-- --env <env>` がパスワードだけを取り出して Proxy 越しにつなぐ。誰にも読む権限を付けない） |
| `BACKUP_BUCKET` | 週 1 の書き出しの入れ物（`optionlist-backups`。書き出しの Job だけ。data.md §6） | Cloud Run Job の環境変数 |
| `PHOTO_BUCKET` | 写真の入れ物の名前（なければ `UPLOAD_DIR` の `LocalPhotoFiles`） | Cloud Run の環境変数 |
| `METRICS_TOKEN` | `/api/metrics` のトークン | Secret Manager |
| `IP_HASH_SECRET` | IP を HMAC する秘密の値（api.md §6） | Secret Manager |
| `PUBLIC_INDEXING` | `true` のときだけ検索エンジンに載せる（§4.3。なければ noindex） | Cloud Run の環境変数（R11 で `true`） |
| `FRONTEND_DIST` | ビルド済みの frontend のフォルダ。なければ画面を配らない（手元の `npm run dev`・API テスト） | イメージに入れてある（`/app/frontend/dist`。E2E は `../frontend/dist`） |

- 秘密の値は、リポジトリ・GitHub の変数・ログに置かない。手元は `backend/.env`（git に入れない）
- `APP_ENV` が `staging` か `production` で、`APP_ORIGIN`・`METRICS_TOKEN`・`IP_HASH_SECRET`・`PHOTO_BUCKET` のどれかがなければ、backend は起動の時点で止まる（`infra/AppConfig.ts`。docs/decisions/0050・0051）。手元は `APP_ENV` を書かなければ `development`、`APP_ORIGIN` を書かなければ Host と比べる（api.md §1）。`METRICS_TOKEN` を書かなければ `/api/metrics` はいつも 404
- 手元と CI では、`GCS_EMULATOR_URL`（fake-gcs-server の URL。`@google-cloud/storage` の `apiEndpoint` に渡す。ライブラリが直接読む `STORAGE_EMULATOR_HOST` は URL がずれるので使わない）を `GcsPhotoFiles` のテストに使う（testing.md §2）。確認用・本番には置かない
- 手元と CI では、ロールと DB を作る superuser の `ADMIN_DATABASE_URL` も使う（`db:roles` だけが読む。data.md §4）。手元の `DATABASE_URL` も `ol_migrator`、アプリは `APP_DATABASE_URL`（`ol_app`）で接続する

### 4.3 本番での振る舞い
- `APP_ENV` が `staging` か `production` なら、PortGuard（docs/decisions/0007）を使わず、`trust proxy` を 1 にし、Cookie に `Secure` を付ける
- Express がビルド済みの frontend（`frontend/dist`）も配る。`/api` 以外で、ファイルに当たらない GET・HEAD は `index.html` を返す（画面のルーティング）。ただし `/assets/` の下でファイルがなければ 404（古い版のタブが消えたチャンクを読みに来たときに、HTML を JS として渡さない）。名前にハッシュが付いたファイル（`/assets/` の下）は `Cache-Control: public, max-age=31536000, immutable`、`index.html`・Service Worker・そのほかのファイルは `no-cache`（docs/decisions/0054）
- イメージ（`Dockerfile`）の中の backend は、ビルドせず tsx で TypeScript のまま動かす（`node --import tsx src/server.ts`。docs/decisions/0054）
- 画面の応答（`/api/` 以外）に付けるヘッダー（docs/decisions/0038）: `Content-Security-Policy: default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`、`Strict-Transport-Security: max-age=31536000`、`Referrer-Policy: same-origin`、`X-Content-Type-Options: nosniff`、`Permissions-Policy: camera=(), microphone=(), geolocation=()`。外のスクリプト・フォント・計測タグは読まない
- 公開の段階（docs/decisions/0045）の 2 段目が終わるまでは（3 段目の一般公開で外す）、検索エンジンに載せない。`PUBLIC_INDEXING` が `true` でなければ、すべての応答に `X-Robots-Tag: noindex` を付け、Express が `index.html` を返すときに `<meta name="robots" content="noindex">` を `<head>` に差し込む。ビルドした `index.html` には meta を入れない（確認用と本番は同じイメージを出すので、ビルドに入れると実行時に外せない）。`PUBLIC_INDEXING=true` にすると、どちらも付けない
- ログは 1 行 1 つの JSON（`severity`・`message`・`kind`・`route`・`status`・`durationMs`）で標準出力に出す。Cookie・復旧コード・タイトル・写真の名前は出さない（docs/decisions/0042）
