# 0003 品質チェックの判定の細部

- 日付: 2026-11-01
- 状態: 確定
- 対象: metrics.md §2・§3、testing.md §0・§6

## 決めたこと
- 計測の仕組みがまだない指標は「未計測（ステップ N で導入）」としてレポートに出し、失敗にしない。対象のファイルがまだない指標（tokens.css、UT の対象の services・controllers・lib）は「対象なし」で合格とする
- 計測するはずの値が取れなかったとき（カバレッジやビルド成果物が見つからない、UT の対象ファイルがあるのにカバレッジがない）は、目標を割ったのと同じに扱う。`since` が 1a の指標はすべて計測値が出ることをテストで確かめる
- 例外の握り潰しは「throw・console/logger・res/next の呼び出し・受け取ったエラーを値として使う」のどれもしない `catch`、`.catch()`、`.then()` の第 2 引数とする。`setError(e)` のように呼び出し元や画面にエラーを渡しているものは握り潰しに数えない。`.catch(noop)` のようにハンドラを名前で渡したものは中身を確かめられないので数える（`next`・`console.*`・`logger.*` は除く）
- 握り潰しと lint 無効化コメントは backend・frontend・scripts・tools・shared・e2e の全体（設定ファイルとテストを含む）を見る。構文エラーのあるファイルは検査を見逃すので失敗にする
- 色の数は tokens.css に書かれた色の値の種類で数える（名前に関係なく、同じ値の使い回しは 1 色）。文字サイズと余白は `--font-size-*` / `--space-*` に入っている値の種類で数える。色の直書きは CSS の宣言の値と、TS/TSX の文字列・テンプレートの中だけを見る
- backend のカバレッジから `src/server.ts`（listen するだけのエントリーポイント）を除く
- ステップ 2 より先に、DB に接続する API テスト（`/api/health/db`）を 1 本だけ入れる。接続先は CI では MySQL サービスコンテナ、ローカルでは `backend/.env.test`

## 理由
- 目標値はすべて最初から metrics.config.json に入れておき、ステップが進むごとに「未計測」が減っていくのをレポートで見られるようにするため
- 雛形の `/api/health/db` が未テストのままだと backend の行カバレッジが 90% に届かない。テストを除外して数字を合わせるより、DB に届くテストで満たすほうが指標の意味を保てる

## 影響
metrics.config.json、scripts/（metrics-check・check-pr と lib/）、backend/vitest.config.ts・vitest.unit.config.ts、.github/workflows/ci.yml
