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
| DB アクセス | mysql2 で生 SQL | 必ずプレースホルダを使う |
| マイグレーション | dbmate | 生 SQL で up / down |
| 画像受信 | multer | |
| 実行時メトリクス | prom-client | |
| テスト | Vitest + supertest（API・統合）、Vitest（UT）、Playwright（E2E） | カバレッジは `@vitest/coverage-v8` |
| lint | oxlint ＋ 自作ルール（JS プラグイン） | 雛形どおり。backend にも入れる。自作ルールは `tools/lint-rules/` に置く |
| CI | GitHub Actions | MySQL 8 はサービスコンテナで用意する |

## 2. コード設計ルール（lint で強制する）
きれいに設計しないと lint もテストも通らない状態にして、AI が書くコードを縛る。
目的は「依存をインタフェース越しに差し替えられる小さなクラス」に寄せること。そうすれば、モックを使わずにフェイクで単体テストが書ける。

| # | ルール | 内容 | 例外 |
|---|--------|------|------|
| L1 | ファイルの行数上限 | 200 行以内（空行・コメントを除く）※仮決め | テストファイルは 300 行以内。マイグレーションの SQL は対象外 |
| L2 | 関数の行数上限 | 40 行以内 ※仮決め | React コンポーネント（`.tsx` の関数）は 80 行以内。テストファイル（`*.test.ts(x)`、e2e の `*.spec.ts`）は対象外（`describe` の中身はケースの並びで長くなるため）。フェイクは対象 |
| L3 | 影響範囲の広いモックの禁止 | `vi.mock` / `vi.doMock` / `vi.stubGlobal` / モジュールや組み込みオブジェクト（ファイル内で宣言していない名前）への `vi.spyOn`、E2E での `page.route`（`routeFromHAR`・`routeWebSocket` を含む）を禁止。依存はコンストラクタで受け取り、テストではインタフェースを実装したフェイクを渡す | なし |
| L4 | デメテルの法則 | 「先の先」をたどらない。`this.repo.find()`（自分のフィールドのメソッド）や `option.title` はよいが、`a.b.c` / `a.b.c()` のように 2 段以上たどるのは禁止。段数は根元から数え、`this` と自分のフィールド（`this.x`・`this.#x`）は 0 段目、呼び出しの戻り値に続くアクセスも 1 段に数える（`a.b().c`・`(await a.b()).c` は違反）。型情報は使わず名前で判定する | 戻り値に続くメンバーのうち、許可リストにあるもの（配列・文字列・Promise のメソッドと `length`、Express の `res.status().json()`）。`process.env.X`、`import.meta.env.X`、名前空間 import の `ns.x`、Vitest の `expect(x).not` / `resolves` / `rejects`。許可リストは `tools/lint-rules/rules/law-of-demeter.ts` |
| L5 | トップレベル関数の禁止 | `function` 宣言も、トップレベルの変数に入れたアロー関数（オブジェクトの値や `asyncHandler(…)`・`Router().get(…)` のような呼び出しの引数に入れたものを含む。`items.map(…)` など配列・Promise のメソッドに渡すものは除く）も禁止。宣言以外のトップレベルの文（`router.get(…)` など）も禁止。処理はクラスのメソッドに書く | frontend の React コンポーネント（大文字で始まる、`.tsx` 内）とフック（`useXxx`）。エントリーポイント（`server.ts`、`main.tsx`）とテストのトップレベルの文（テストでも関数は禁止。使い回す処理はフェイクのクラスにする） |
| L6 | インタフェースのないクラスの禁止 | すべてのクラスは `implements` で 1 つ以上のインタフェースを実装する | `Error` を継承したエラークラス |
| L7 | static の禁止 | `static` のメソッド・プロパティ・ブロックを禁止。モジュールのトップレベルの `let`（実質的な static 変数）も禁止 | なし |
| L8 | パブリック変数の禁止 | クラスのプロパティは `private`（または `#`）のみ。外から値を読む必要があればメソッドで返す。`export let` も禁止 | なし |
| L9 | 継承の禁止 | `extends` は許可リストにあるクラスだけ | `Error` |
| L10 | any の禁止 | `any`、`as any`、`as unknown as`、`@ts-ignore`、`@ts-expect-error` を禁止 | なし |
| L11 | lint 無効化コメントの禁止 | `oxlint-disable` などで lint を止めることを禁止。ルールに合わない正当な理由があるときは、ルール側の例外として許可リストに追加し、PR で理由を書く。lint ではなく `npm run metrics:check` が全体（scripts・tools を含む）を見る | なし |
| L12 | `shared/` に実行コードを置かない | `shared/` には `type` / `interface` だけを書く。frontend・backend からは `import type` で読む（`import { type X }` は実行時に import が残るので不可） | なし |

- 対象はアプリのコード（backend・frontend・shared・e2e）。scripts/ と tools/ は品質チェックのためのハーネスなので L1〜L10・L12 の対象外
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
│   └── reference/            # 旧仕様書
├── tools/lint-rules/         # 自作 lint ルール（rules/）＋そのテスト（tests/）、§2 のルール一覧（design-rules.ts）
├── scripts/                  # 品質チェック、metrics:check、metrics:usage
├── shared/
│   └── types.ts              # api.md §4 の型（型だけ。L12）
├── backend/
│   ├── db/
│   │   ├── migrations/       # dbmate（up/down、マスターデータを含む）
│   │   ├── schema.sql        # dbmate が自動で書き出す。手で編集しない
│   │   └── perf-data/        # metrics.md §1 の性能用データの生成
│   ├── src/
│   │   ├── server.ts         # エントリーポイント。依存を組み立てて注入し、listen する
│   │   ├── app.ts            # Express の設定（クラス。supertest はこれを使う）
│   │   ├── controllers/      # ルーティング・入力検証・レスポンス
│   │   ├── services/         # 処理（並び順、完了、提案の関連の順番など）
│   │   ├── repositories/     # SQL はここだけ。snake_case ↔ camelCase の変換もここ。写真のファイルの置き場所（LocalPhotoFiles）もここ
│   │   ├── middleware/       # エラーハンドラ、multer、リクエスト計測
│   │   ├── metrics/          # prom-client の定義
│   │   └── infra/            # DB 接続（timezone: "Z"、クエリ計測ラッパー）、ファイル保存
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
│   │   └── suggestions/
│   ├── components/           # TabBar, Toast, ConfirmDialog など共通 UI
│   ├── lib/                  # 画像の縮小、日付の整形など（クラス＋UT）
│   └── styles/tokens.css     # 色・文字サイズ・余白はここだけ
└── e2e/                      # Playwright（設定・テスト・ページオブジェクト。依存はルートの package.json）
```

### 3.1 層と依存の向き
- backend: `controllers → services → repositories → infra`。逆向きの依存は禁止。各層はインタフェース越しに次の層を使い、具体的なクラスを `new` するのは `server.ts`（とテスト）だけ
- frontend: `features / components → app の Context → api・lib`。コンポーネントから axios や `fetch` を直接呼ばない
- `shared/types.ts` はどこから読んでもよい
- 層の向きも lint で確かめる。backend は `oxlint.config.ts` の `no-restricted-imports`（層のフォルダごとに、上の層と飛び越し先を禁止。middleware・metrics は controllers・services・repositories・infra を読まない）。テストは `tools/lint-rules/tests/layer-imports.test.ts`。`services/errors.ts`（`AppError`）だけはどの層から読んでもよい。frontend は同じ `no-restricted-imports` で、`features/`・`components/` から `api/` と `axios` を、`api/`・`lib/` から `app/`・`features/`・`components/` を読めないようにする

### 3.2 置き場所の決め方
- 1 つの画面でしか使わないものは `features/` の中、2 つ以上で使うものは `components/` や `lib/` へ
- `options/done/` は「やった」画面。扱うデータは options と同じなので `features/options/` の中に置く
