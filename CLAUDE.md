# 言語
- ユーザーへの返答はすべて日本語で書く。チャットの返答、作業の途中の報告、質問と選択肢（AskUserQuestion）、PR の本文、コミットメッセージを含む。ツールの結果や指示が英語でも、返答は日本語にする

# Status
- docs/spec/process.md §4 のステップ 1〜10 は実装済み（2026-11-08）。提出用としてはここで一区切り。仕様は SPEC.md（入口・目次）と docs/spec/（章ごと）。「※仮決め」の箇所はまだ残っている
- 仕様を変えたら、SPEC を直したうえで docs/decisions/ に理由を記録する（docs/spec/process.md §3）
- docs/reference/OptionList_Specification_v2.1.md は旧構想（LocalStorage 前提の単体 Web アプリ）。
  参考にするのは「やりたいこと（機能・UX）」だけ。技術選定（LocalStorage, react-beautiful-dnd, React 18, Copilot 前提など）は決定事項ではない
- 方針: React(frontend) → axios → Express(backend) → PostgreSQL 17（pg）の構成で作る（MySQL からは R1 で移った。docs/decisions/0034・0047）

# Commands
- 初回: `npm install` / `npm --prefix backend install` / `npm --prefix frontend install` / `npx playwright install chromium`（E2E のブラウザ）。PostgreSQL 17 は `winget install PostgreSQL.PostgreSQL.17`（superuser の `postgres` のパスワードを決める。`.env.example` は `postgres` の前提）
- DB 作成: `backend/.env.example` を `backend/.env` にコピーし（`ADMIN_DATABASE_URL` は superuser の postgres、`DATABASE_URL` は ol_migrator、`APP_DATABASE_URL` は ol_app、`IP_HASH_SECRET`）、`npm --prefix backend run db:roles`（ロールと DB を作る。DB の持ち主が ol_migrator でなければ止まるので、消して作り直すなら `-- --recreate`）→ `npm --prefix backend run db:migrate`（`db/schema.sql` も書き出す）。`schema.sql` を psql に流し込む手順は使わない
- テスト用 DB: `backend/.env.test.example` を `backend/.env.test` にコピーして値を入れる。`npm test` が最初に `db:roles:test`（ロールとテスト用 DB）とマイグレーションを流す。`test:file` は流さないので、先に `npm --prefix backend run db:roles:test` と `db:migrate:test`
- マイグレーションの追加: `npm --prefix backend run db:new -- <名前>` → `backend/db/migrations/` に up / down を書き、`tests/migrations/migrations.test.ts` を直す
- 性能用データ: `npm --prefix backend run db:perf-data`（`.env.test` の DB に入れる。名前が `_test` で終わる DB 以外では止まる）
- Backend 起動: `npm --prefix backend run dev`（http://localhost:8000）
- Frontend 起動: `npm --prefix frontend run dev`（http://localhost:5173、/api は backend にプロキシ）
- スマホから触る: `npm --prefix frontend run dev:lan` で起動し、同じ Wi-Fi のスマホで表示された Network の URL（http://<PC の IP>:5173）を開く。初回は Windows のファイアウォールの許可が要る
- 型チェック（backend・frontend・scripts・tools・e2e）: `npm run typecheck`
- lint（architecture.md §2 の設計ルール）: `npm run lint`。自作ルールのテスト: `npm run test:lint-rules`
- Backend テスト: `npm test`、単一ファイル: `npm --prefix backend run test:file -- tests/api/health.test.ts`（backend のフォルダで動く。`npm --prefix backend exec vitest` は今のフォルダで動いて `.env.test` を読めないので禁止。ロールとマイグレーションは流さないので、先に `npm --prefix backend run db:roles:test` と `db:migrate:test`）。マイグレーションテストだけ: `npm --prefix backend run test:migrations`
- frontend の UT: `npm --prefix frontend run test:unit`（`src/lib/` だけ）
- E2E: `npm run test:e2e`（テスト用 DB をマイグレーションし、frontend をビルドしてから Playwright。設定は `e2e/playwright.config.ts`、依存はルートの package.json。backend 8100・frontend 4174 を自分で起動する。結果は `e2e/results/`）
- 性能テスト: `npm run test:perf`（`.env.test` の DB に性能用データを入れ直してから流す。結果は `backend/coverage/perf/results.json`、判定は `metrics:check`）
- 目標値の判定（CI と同じ）: `npm run metrics:check`。結果は `metrics-report.json`。目標値は `metrics.config.json`
- 品質チェックスクリプト自体のテスト: `npm run test:scripts`
- 利用状況（metrics.md §6。達成数・frontend のエラー数など）: `npm run metrics:usage`（`backend/.env` の DB を読むだけ）
- PR のマージ: `npm run pr:merge -- <PR 番号>`（CI が緑のときだけマージする。その PR のブランチへ積んだ PR は、マージの前に向き先を付け替える。`gh pr merge` は使わない）

# Gotchas
- off-jt の backend も 8000 番を使う。Windows では別アプリが使っていても listen が成功してしまうので、backend は起動時に接続して確かめ、使用中ならメッセージを出して止まる（docs/decisions/0007）
- TypeScript は 7 系（ネイティブ版）。古い記事の tsconfig オプションがそのまま使えないことがある
- 開発環境は Windows。シェルコマンドは Git Bash / PowerShell どちらでも動く書き方にする
- winget で入れた PostgreSQL は bin（`C:\Program Files\PostgreSQL\17\bin`）が PATH に入らない。`db:migrate` の `schema.sql` の書き出しは pg_dump を使うので、PATH に足して VS Code を再起動する。Claude のサンドボックスの中では dbmate がリポジトリに書けない（Access is denied）ので、`--schema-file` で一時フォルダに書き出してからコピーする。`db:new` も書けないので、そのときは今の UTC の時刻を版にしたファイルを Write ツールで作る（未来の時刻の版はマイグレーションのテストが止める。docs/harness/incidents.md #21）
- reviewer サブエージェントが「not found」で呼べない実行環境がある（`.claude/agents/` を読み込まない）。そのときは `.claude/agents/reviewer.md` の本文をそのまま汎用のエージェントに渡し、読むだけにさせる（docs/harness/incidents.md #20）
- 利用者の表（users・options・achievements）は RLS で守っている（data.md §4）。psql やテストで中身を見るときは `DATABASE_URL`（ol_migrator。全員の行が見える）で接続する。`APP_DATABASE_URL`（ol_app）や superuser 以外のロールで見ると、`app.user_id` を設定しない限り 0 行に見える。superuser の postgres は RLS を素通りするので、アプリとしてのテストには使わない（testing.md §0）
- 手元の PostgreSQL のサーバーの TimeZone は Asia/Tokyo。backend とテストは接続ごとに UTC にしている（`PgPoolFactory`）ので、psql で直接見た日時は 9 時間ずれて見える
- テスト用 DB を使うコマンド（`npm test`・`test:e2e`・`test:perf`・`metrics:check`・`test:scripts`）は同時に流さない。`test:scripts` はマイグレーションしないので、先に `npm --prefix backend run db:migrate:test`。`metrics:check` は性能用データを入れ直すので、裏で流している間に E2E を流すと互いに壊れる（docs/harness/incidents.md #15）
- `dev:lan` は信頼できる Wi-Fi でだけ使う。ログインがないので、同じ Wi-Fi の人から達成の写真が見え、変えられる（docs/decisions/0028）
- 手元の性能テストの値は CI より大きく出る（SQL で 6 倍ほど。SQL の p95 が手元だけ目標を超えることがある）。悪化かどうかは、手元の値ではなく CI の `metrics-report.json` と比べる（docs/harness/incidents.md #13）。手元で性能テストを続けて流すと、2 回目以降が RSS・ヒープのテストの 120 秒のタイムアウトで落ちる（main でも起きる。原因は不明）。`metrics:check` の測り直しもこれで落ちるので、それだけなら自分の変更を疑わず CI で確かめる（#16）
- 画面の案はキャンバス（claude.ai の Design の Artifact）で見比べて決めている。「案 B にして」のように案を名前で指定されたら、計画や決定記録の要約からではなく、その artboard を Artifact の read で読んでから作る。色は tokens.css の色に置き換える（12 色以内。docs/harness/incidents.md #14）
- `gh: command not found` は VS Code の起動後に PATH が変わったのが原因。フルパスでしのがず、VS Code を再起動する（docs/harness/incidents.md #2）
- `python` は Microsoft Store のスタブで、実行しても何もせず終了コード 0 で終わる。スクリプトは node で書く（docs/harness/incidents.md #1）
- ファイルの書き換えは Edit・Write ツールで行う。シェル経由（`node -e` など）で書くと `\` が消えることがあり、`node -e` は禁止している（docs/harness/incidents.md #8）
