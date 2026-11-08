# 0005 コード設計ルール（lint）の判定の細部

- 日付: 2026-11-01
- 状態: 確定
- 対象: architecture.md §2・§3、SPEC.md §3、metrics.md §2

## 決めたこと
- 自作ルールは oxlint の JS プラグイン（TS のまま型除去で読む）で書き、`RuleTester`（`oxlint/plugins-dev`）を node:test で動かしてテストする。ESLint は併用しない
- 対象はアプリのコード（backend・frontend・shared）。scripts/ と tools/ は対象外。L11（無効化コメント）は lint ではなく `npm run metrics:check` の既存の検査で全体を見る
- L2 はテストファイル（`*.test.ts(x)`、e2e の `*.spec.ts`）を対象外にする。tests/fakes/ などテストファイル以外は対象のまま。React コンポーネントの 80 行は「`.tsx` の関数」で近似する
- L4 は根元からの段数で数え、2 段以上を違反にする。`await` を挟んでも段数は変わらない（`(await a.b()).c` は違反）。`this`・自分のフィールドは 0 段目。戻り値に続く許可リストのメンバー（配列・文字列・Promise のメソッドと `length`、`json`・`send`・`end`）は段数を増やさない。型情報は使わず名前で判定する。仕様の例外に加えて、名前空間 import の `ns.x` と `expect(x).not` / `resolves` / `rejects` を許す
- L5 はトップレベルの関数（変数の初期値のオブジェクトの値・配列の要素・呼び出しの引数に入れた関数を含む。`asyncHandler(…)`・`Router().get("/", …)`・`Object.freeze({ … })` も対象。`items.map((x) => …)` のように L4 の許可リストにある配列・Promise のメソッドに渡すものは値の計算なので含めない）に加えて、宣言以外のトップレベルの文（`router.get(...)` など）も禁止する。トップレベルの文はエントリーポイントとテストだけ許す。`const x = f()` のように値を作るだけの宣言はよい（React の `createContext` などのため）。フック（`useXxx`）の例外は frontend だけ
- L3 の `vi.spyOn` は、対象の根元が import した名前か、ファイル内で宣言していない名前（`URL`・`HTMLCanvasElement` などのグローバル）なら違反にする。組み込みオブジェクトを名前の一覧で決めると抜けが出るため
- L12 は `import type` / `export type` だけを許す。`import { type X }` は `verbatimModuleSyntax` だと実行時に import が残る
- 雛形の違反は、ステップ 1c まで `tools/lint-rules/legacy-files.ts` に挙げたファイル（4 件）だけ設計ルールを外す。除外中はレポートの備考に件数を出す
- 設計ルールの違反の数は、`tools/lint-rules/design-rules.ts` に挙げたルールの診断だけを数える（oxlint の既定の correctness ルールの警告は数えない）

## 理由
- oxlint 1.90 で 10 本の自作ルールがすべて書けた（180 ケースのテストが通る）。ツールを 1 つにしたほうが設定と CI が単純になる
- scripts/ と tools/ は AST や JSON を読むコードが多く、L4 に合わせると読みにくくなる。アプリの設計を縛るという目的にも入らない
- lint の中で無効化コメントを止めても、無効化コメントで止め返せる。外側の検査で見るほうが確実
- テストの `describe` の中身はケースの並びで、40 行を超えても読みにくくならない
- `expect(x).not.toBe()` を違反にすると、テストの書き方が不自然になる
- 雛形を 1b で直すと 1c と範囲が重なる。除外は名前で列挙し、新しいファイルが紛れ込まないようにした

## 影響
oxlint.config.ts、tools/lint-rules/、scripts/lib/lint-collector.ts・lint-rule-test-checker.ts、scripts/metrics-check.ts、architecture.md §2・§3、SPEC.md §3（未決事項から「JS プラグインで書けるか」を削除）、package.json（`lint`・`test:lint-rules`）、frontend の oxlint の設定と依存を削除
