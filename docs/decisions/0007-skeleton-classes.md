# 0007 雛形のクラス化での判断（エラー、メトリクスのラベル、ポートの確認、層の lint）

- 日付: 2026-11-01
- 状態: 確定
- 対象: architecture.md §2・§3.1、api.md §3、metrics.md §5、process.md §2・§4

## 決めたこと
- 想定内のエラーは `AppError(code, message)` 1 つのクラスにし、status は code から決める。置き場所は `backend/src/services/errors.ts`（どの層からも読んでよい）
- 共通のエラーハンドラは、`express.json` などが投げる 4xx（JSON の解析失敗、413 など）をすべて 400 `VALIDATION_ERROR` にする。どのルートにも当たらない `/api/*` は 404 `NOT_FOUND` の JSON で返す
- `http_*` メトリクスの `route` ラベルはルートの定義（`/api/options/:id`）にし、どのルートにも当たらないものは `unmatched` にまとめる。controllers はパスを `/api` から書き、app に直接登録する（入れ子の Router にしない）
- backend は listen の前に `127.0.0.1` と `::1` の両方に接続してみて、つながったらメッセージを出して終了する。listen の `EADDRINUSE` も同じメッセージにする
- architecture.md §3.1 の層の向きを、backend だけ先にこのステップで lint（`no-restricted-imports`）にする。middleware・metrics は横断的な部品なので controllers・services・repositories・infra を読まない。frontend 側はステップ 4
- 雛形の `/api/health`・`/api/health/db` は疎通確認として残し、api.md §2 に載せる
- `/api/metrics` は metrics.md §5 のうち、今あるコードで値が出るもの（`http_*`、`db_query_duration_seconds`、`unhandled_errors_total`、標準メトリクス）だけを定義する。`orphan_file_errors_total` は画像を扱うステップ 8 で足す

## 理由
- 継承は `Error` だけ（L9）なので、`ValidationError extends AppError` のようなサブクラスは作れない。許可リストを増やすより code で区別するほうが単純
- エラーは controllers・services が投げ、middleware が読む。middleware から services を import するのは層の lint で止めているので、例外として `services/errors.ts` だけを許す
- URL をそのままラベルにすると、存在しない URL や id ごとにラベルが増える。入れ子の Router では、エラーで `next(err)` したときに `req.baseUrl` が戻り、同じルートでもラベルが変わる
- Windows で確かめたところ、別のプロセスが `127.0.0.1:8124` で待ち受けていても、Node の `listen(8124)`（`::`）は成功した。これが Gotchas の「`/api/...` が "Cannot GET"」の原因（Vite のプロキシが別のアプリに届く）。listen のエラーだけでは防げない
- 層の lint はフォルダを作るときに入れるのがいちばん安い。後から入れると、違反の修正が先に必要になる。フォルダごとの設定なので RuleTester では試せず、実際のフォルダに一時ファイルを置いて oxlint を流すテストにした
- 使わないメトリクスを先に定義すると、常に 0 の値が出て「問題なし」に見えてしまう

## 影響
backend/src/ 全体、oxlint.config.ts、tools/lint-rules/design-rules.ts（`no-restricted-imports` を違反数に含める）、tools/lint-rules/legacy-files.ts を削除（scripts/ の参照も削除）、architecture.md §2・§3.1、api.md §2・§3、CLAUDE.md の Gotchas、.claude/rules/
