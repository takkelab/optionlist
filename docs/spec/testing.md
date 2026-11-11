# テスト

[SPEC.md](../../SPEC.md) の一部。目標値は metrics.md を参照。

## 0. 共通
- 単体テスト（UT）は、依存をインタフェースを実装したフェイクに差し替えて書く。モジュールを丸ごと置き換えるモックは使えない（architecture.md §2 の L3）。フェイクは `backend/tests/fakes/` などにまとめて再利用する
- 種類ごとにフォルダを分け（`tests/unit/`、`api/`、`migrations/`、`perf/`）、UT だけのカバレッジを計測できるようにする
- DB は PostgreSQL 17（手元は Windows に直接入れたもの、CI は `postgres:17` のサービスコンテナ。architecture.md §4.1）
- テスト用 DB は `optionlist_test`。接続先は `backend/.env.test` で切り替え、テスト開始時に dbmate で最新までマイグレーションする（`npm test` が vitest の前に `db:roles:test` と `db:migrate:test` を流す）。ロール（data.md §4）は `db:roles:test` がなければ作り、テスト用 DB はいつも `ol_migrator` の持ち物として作り直す（別のブランチのマイグレーションの表を残さない）
- 前提の人は、鍵が分かる人を `ol_migrator` で users に直接入れて作り（`backend/tests/fakes/TestUsers.ts`）、その Cookie で API を呼ぶ。API テストのクライアントは、応答の `Set-Cookie` で Cookie を入れ直す（ブラウザと同じ）。E2E の種まきは `page.request`（ブラウザと同じ Cookie）で呼ぶ
- **アプリとしてのテストは、本番と同じ `ol_app` で接続する**（`APP_DATABASE_URL`）。スーパーユーザー（CI の既定の `postgres` など）は RLS を素通りし、`ol_migrator` は `USING (true)` のポリシーで全員の行を読み書きできる（data.md §4）ので、どちらで流しても RLS が効いていなくても通ってしまう。データを空にする・入れ直す後始末と、性能用データの投入だけは `ol_migrator` で行う（`DATABASE_URL`。全員の行に効く）。CI の `postgres` はロールとデータベースを作るときだけ使う
- テスト用 DB を共有するので、backend のテストファイルは並列に流さない（vitest の `fileParallelism: false`）
- テストで保存する画像は `UPLOAD_DIR` で別フォルダに出す

## 1. マイグレーションのテスト（Vitest）
- テスト用 DB とは別の DB（`optionlist_test_migrations`）を作り直しながら行う。`npm --prefix backend run test:migrations` で単独でも流せ、失敗したケース数が metrics.md §2 の指標になる
- 空の DB に対して、全マイグレーションの up → down → up が通ること
- マイグレーションを 1 本ずつ up / down し、各段階で down が up の変更を元に戻すこと（テーブル・列・インデックス・関数の一覧を比べる。関数だけを足すマイグレーションでも差が見えるように）
- どのマイグレーションの版（ファイル名の先頭の日時。UTC）も、未来の日時でないこと（未来の版があると、`db:new` が付ける今の時刻の版がその前に並ぶ。docs/harness/incidents.md #21）
- up 後のテーブル・列・インデックス・外部キーが期待どおりであること
- マスターデータ（提案とテーマ・タグ。data.md §2）が入っていること。どの提案にもタグが 2〜4 個付き、どのタグも 3 件以上の提案に付いていること。どの月にも季節の提案が 5 件以上あること。季節の CHECK 制約が効くこと。基準のマイグレーションのマスターデータが、MySQL 時代の最後の状態（`backend/tests/migrations/fixtures/suggestions-mysql-final.json`）と ID・中身まで一致すること（docs/decisions/0044）
- RLS・ロール・認証の関数が data.md §4 のとおりであること（詳しくは §7）
- 認証の関数・集計のビューを作るマイグレーションが、`ol_migrator` で流して up → down → up まで通り、関数・ビューの持ち主が `ol_definer` になること（`SET ROLE ol_definer` で包み忘れると、作り直し・down で「must be owner」になって落ちる。data.md §4）
- 提案を入れ替えるマイグレーションで、旧提案に付いていた options の `suggestion_id` が NULL になり、options の行は残ること
- 新しいマイグレーションを追加したら、このテストも必ず追加・更新する

## 2. backend API テスト（Vitest + supertest）
- 各テストの前にデータを空にし（マスターデータは除く）、必要なデータを入れ直す
- api.md §2 のすべての API について、正常系と主なエラー（400 / 404 / 409）をテストする
- 特に確認すること
  - 先頭への追加、並び替え、やったリストへの移動、やりたいリストへ戻したときの順番、予定日がある項目を上に日付順で並べること、予定日を消したときの順番
  - 提案に、そこから追加した option の状態（追加済み・やった・なし）が付くこと。option を削除すると「なし」に戻ること
  - 関連が、共有するタグの多い順（同じなら id 順）に最大 5 件で、自分を含まないこと
  - 削除で達成記録と写真のファイルが消えること。写真の付け替えで古いファイルが消えること。ファイルを消せなくても API は成功し、`orphan_file_errors_total` が増えること
  - 写真の形式を申告ではなく中身で確かめ、形式違反と 5MB 超が 400 になること
  - 予定日を入れて消せること、実在しない日付が 400 になること
  - 想定外のエラーで 500 が返り、`unhandled_errors_total` が増えること
  - アカウント（api.md §6）: Cookie がなければ一覧が空で、アカウントを作らないこと（読むだけ・events だけでは users が増えない）。`POST /api/options` で初めてアカウントができ、`Set-Cookie` に `HttpOnly`・`SameSite=Lax`・`Path=/`・`Max-Age` が付くこと。`last_seen_at` が 1 日 1 回だけ書かれ、そのとき Cookie を入れ直すこと（時計はフェイクで進める）
  - 復旧コード: 発行したコードで別の Cookie から移れ、移ったあと元の Cookie では一覧が空になること。使ったコードと、作り直す前のコードが 404 になること。空白・ハイフン・小文字を混ぜても通ること。移る側の端末にあった古いアカウントが消えること。**自分のアカウントのコードを自分の端末で入れたときは、何も消えず**（項目・写真が残る）、409 にもならず、Cookie だけが新しい鍵になること。この端末に別のアカウントの項目があるとき、`replace` なしでは 409 と件数が返ってコードが使われず（もう一度使える）、`replace: true` で移れること
  - 回数の制限: 同じ IP からのアカウントの作成と復旧コードの入力が上限で 429 になり `Retry-After` が付くこと。合っているコードでも、上限を超えたら 429 のままで、コードは消費されないこと。上限の前の合わないコードは 404 であること。アカウントのない `POST /api/events` が、同じ IP から上限を超えると 429 になること
  - すべてのデータを消す: 行と写真のファイルが消え、Cookie が消えること。アカウントがなくても 204 になること
  - セキュリティ（docs/decisions/0038）: `Origin` が違う書き込みが 403 になること。`Content-Type` が JSON でない JSON の API が 400 になること。`/api/metrics` がトークンなし・違うトークンで 404 になること。`APP_ENV=production` で `/api/health/db` が `message` を返さないこと。500 の `message` に内部の情報が出ないこと
  - 写真（docs/decisions/0037）: 位置情報の入った JPEG を送ると、保存されたファイルに EXIF が残っていないこと。長辺が 1280px に縮み、JPEG で保存されること。先頭だけ JPEG の読めないファイルが 400 になること。写真の配信に `Cache-Control: private`・`Vary: Cookie`・CSP・`Content-Disposition: inline` が付くこと。1 人あたりの上限で 429 `PHOTO_LIMIT_REACHED` になり、置き換えは上限でも通ること。保存の回数の制限で 429 と `Retry-After` になること
  - 写真の置き場所（`tests/api/photo-files-contract.test.ts`）: `LocalPhotoFiles` と `GcsPhotoFiles` を同じテストで確かめる（保存して同じ中身が読める、名前がサーバーの UUID、消したら読めない、ない名前を読むと null で消しても失敗しない、置いた時刻より後の境目を渡したときだけ「古いファイル」に出る）。`GcsPhotoFiles` は fake-gcs-server につなぎ、API 越しの保存と配信も確かめる。手元で `GCS_EMULATOR_URL` がなければ GCS の分を飛ばし、CI では飛ばさずに失敗にする（docs/decisions/0051）
  - 削除のジョブ（`tests/api/cleanup-job.test.ts`。data.md §5）: 本番と同じ `ol_cleanup`（`CLEANUP_DATABASE_URL`）でつなぐ。時計はフェイクで、5 年・30 日・90 日・7 日・行のない写真の 1 日のそれぞれで、境目の 1 秒前（古い側）が消え、ちょうどと 1 秒後が残ること。30 日を過ぎても項目か達成がある人は残ること。消した人の項目・達成・写真のファイルが消え、ほかの人の行と写真が残ること。写真のファイルを消せなくても行は消えてジョブは成功し、`orphan_file_error` が出ること。`cleanup_result` の件数が合い、ID・ファイル名が出ないこと
  - 週 1 の書き出し（`tests/api/backup-job.test.ts`・`tests/api/backup-files.test.ts`。data.md §6）: pg_dump の代わりに node を起動し、接続先が環境変数で渡ること（コマンドラインにパスワードを出さない）、`<DB>/<UTC の日時>.dump` に置いて `backup_result` に大きさを出すこと、pg_dump が途中で失敗したら途中までのファイルを残さず `backup_failed` で終了コード 1 になること、`DATABASE_URL`・`BACKUP_BUCKET` がなければ止まること。`GcsBackupFiles` は fake-gcs-server で、上書きしないこと・流れが壊れたらファイルができないことを確かめる（`GcsPhotoFiles` と同じく、CI では必ず流す）
  - 復旧の訓練の判定（`scripts/tests/restore-drill.test.ts`。`npm run test:scripts`）: 表ごとに S′ が空なら失敗、S′ の ID が戻した DB になければ失敗、R にしかない ID は成功、前後で写真が変わった達成は数えない、`docs/ops/restore-drills.md` の行の書式（data.md §6）
  - テストで送る写真は本物の画像にする（`tests/fakes/TestImages.ts`。sharp で作り直すので、先頭のバイトだけの偽物は 400 になる）

## 3. 統合テスト（性能）
- metrics.md §1 のデータを生成スクリプト（`backend/db/perf-data/`）で入れてから、metrics.md §4 の指標を計測して目標値と比べる
- 通常の API テストとは分けて実行する（`npm run test:perf`。性能用データを入れ直してから `backend/tests/perf/` を流す）
- 性能テストは計測値を `backend/coverage/perf/results.json` に書くだけ。目標値との比較と測り直し（metrics.md §4）は `npm run metrics:check` が行う

## 4. 単体テスト（Vitest）
- backend: services と、controllers の入力検証を、repository のフェイクを使ってテストする
- frontend: 画面に依存しない処理はインタフェース付きのクラスとして `frontend/src/lib/` に置き、単体テストを書く（日付の整形、画像の縮小サイズの計算、エラーの送信のまとめ方、労いメッセージの選び方など）
- 乱数や現在時刻のように結果が変わるものも、インタフェース越しに受け取ってテストで固定する

## 5. E2E テスト（Playwright）
- スマホサイズ（幅 390px）で実行する。backend はテスト用 DB に向けて起動する（backend へのリクエストを `page.route` で差し替えない）
- `npm run test:e2e` で流す（テスト用 DB のマイグレーション → frontend のビルド → Playwright）。Playwright が backend（8100 番、`backend/.env.test`、`FRONTEND_DIST=../frontend/dist`）を起動し、backend がビルド済みの frontend も配る（本番と同じ形。CSP などのヘッダー〈architecture.md §4.3〉が効いた状態で画面が動くことも確かめ、`csp.spec` で違反が 0 件であることを数える）。普段の開発（8000・5173）と並べて動かせる
- 複数の人は、Playwright のブラウザのコンテキストを分けて作る（Cookie が別になる）
- Service Worker は設定で止め（`serviceWorkers: 'block'`）、シナリオ 14 の `pwa.spec` だけで許す。キャッシュした画面の殻がほかのテストに混ざらないように（docs/decisions/0052）
- 各テストの前に、テスト用 DB のマスターデータ以外を空にする（`e2e/support/TestData.ts`）
- 結果は `e2e/results/` に出す（`report.json`: Playwright の JSON レポート、`ui-metrics.json`: LCP とタップ領域）。判定は `npm run metrics:check`
- 主なシナリオ
  1. 手動で追加 → カードのシートのカレンダーで予定日を決める → 一覧のカードに出て、再読み込みしても残る
  2. 手動で追加 → シートで 🎉 → 「移動する」→ やったリストに出る
  3. 🎉 → 「このまま残す」→ やりたいリストに残り、達成回数が増える
  4. 探す画面から提案を開く →「♡ やりたいリストに追加」→ 項目のシートが開き、最初の一歩と「AI に聞く」（相談文に最初の一歩が入る）が出て、🎉 は出ない → 押すとボタンが塗られて ♡ が弾み、少し待ってシートが開く → シートを閉じると、ボタンが「♥ やりたいリストにあります」になり、やりたいリストの先頭に出る。ボタンから開き直して「取り消す」と、やりたいリストから消えてボタンが戻る。シートを開いたまま戻ると、シートだけが閉じる。関連の提案へ移り、戻るで元の提案に戻れる。タグを押すとタグの一覧に移る。テーマの「すべて N 件」でテーマの一覧に移り、チップで絞っていても全件が出る。「絞り込み」を開いてチップで絞ると「今日すぐできる」が消え、選んだまましまうと絞り込みも外れる。提案のカードと行にテーマの色が付く
  5. 🎉 のあとの移動の確認で写真を付ける → やったリストのタイルに出る → シートで付け替え・削除できる。「このまま残す」でも写真は残る。写真を付けなかった達成に、あとからシートで付けられる
  6. 並び替え → 再読み込みしても順番が保たれている
  7. 削除 → 一覧から消える
  8. やったリストから「やりたいリストに戻す」
  9. API の失敗をトーストで知らせると、`client_error` が発生した画面と一緒に保存される
  10. PC の幅（1280px）では、中身・タブバー・「＋」が中央の列（960px）に収まる（screens.md §1）。提案の棚は ‹ › で横に送れ、スマホでは矢印を出さない（§5）
  11. 2 つのブラウザのコンテキスト（別々の Cookie）で、A が追加した項目が B の一覧に出ない。A が付けた写真の URL を B が開くと 404
  12. A が設定のシートで復旧コードを表示 → B がそのコードを入れる → B に A の一覧が出る → A を再読み込みすると空になる（screens.md §9）
  13. 「すべてのデータを消す」→ 確認 → 一覧が空になり、再読み込みしても空のまま
  14. Service Worker が `/api` をキャッシュしない（オフラインにして再読み込みすると、画面は出て一覧は出ず、トーストが出る。screens.md §7・§10）。`/privacy`・`/terms` が開ける
- metrics.md §3 の LCP とタップ領域もここで計測する（`e2e/tests/ui-metrics.spec.ts`。各画面とダイアログ・メニューで、見えているボタン・リンク・入力欄の大きさを測る）

## 6. CI（GitHub Actions）
push と PR ごとに次を実行する。どれかが失敗したら PR はマージしない。

1. 依存のインストール、`npm audit`
2. PostgreSQL 17 のサービスコンテナを起動し、ロール（data.md §4）を作って、dbmate でマイグレーション。fake-gcs-server を `docker run` で起動する（`npm --prefix backend run gcs:emulator`。サービスコンテナは起動の引数を渡せないため。docs/decisions/0051）
3. 型チェック、lint（自作ルールを含む）、品質チェックスクリプト（metrics.md §2・§3 の静的な指標）
4. 自作 lint ルールのテスト、マイグレーションテスト（RLS とロールの確かめを含む。§7）、UT、API テスト（分離テストを含む。カバレッジつき）
5. 性能の統合テスト（metrics.md §4）
6. frontend のビルドと JS サイズの計測
7. E2E テスト（LCP・タップ領域を含む）
8. 本番用のイメージ（`Dockerfile`）を作り、Postgres のサービスコンテナにつないで起動して、スモークテストをする（`image` ジョブ。`npm run smoke:image -- <イメージ>`〈`scripts/smoke-image.ts`〉。`APP_ENV=production` と `PUBLIC_INDEXING=true` の 2 回起動する。その前に、マイグレーションの Job と同じ `dbmate migrate` と、削除のジョブと同じ `node --import tsx --max-semi-space-size=4 src/jobs/cleanup.ts`〈`PHOTO_BUCKET`・`APP_ENV` を渡さず、`ol_cleanup` でつなぎ、`cleanup_result` を出して終了コード 0〉と、書き出しの Job が使う `pg_dump --format=custom --enable-row-security`〈`ol_migrator` でテスト用 DB を書き出して捨てる。イメージの pg_dump が PostgreSQL 17 を書き出せること。data.md §6〉をイメージの中で流す。metrics.md §2。docs/decisions/0054・0059・0061）
9. PR の検査（process.md の「詰まった点と再発防止策」欄、目標値を変えたときの decisions の有無）
10. 結果をジョブサマリーと `metrics-report.json` に出す

main に入ったときだけ、別のワークフロー（`.github/workflows/deploy.yml`）が、8 と同じ `Dockerfile` で main のコミットのイメージを 1 回だけ作って Artifact Registry に置き、確認用にマイグレーションして出す（8 は PR のコミットで作るので、マージしたコミットのイメージはここで作る。確認用で動いたものが本番に出るものなので、スモークテストの代わりに、確認用で 100% を受けていることと `/api/health`・`/api/health/db` を確かめる。docs/decisions/0057）。本番へは、自分が `workflow_dispatch` で起動したときに、確認用でトラフィックを 100% 受けているリビジョンのイメージを、ダイジェストで指定して作り直さずに出す（architecture.md §4.1。docs/decisions/0055）。

## 7. 他人のデータが見えないこと（docs/decisions/0046）
他人のデータが見えないことは、文章の注意ではなく、次の 3 つで機械的に確かめる。どれかが欠けたら CI が落ちる（metrics.md §2）。

1. **lint（SQL を流す入口）**: architecture.md §2 の L13。利用者の表に触る SQL は `UserScopedDatabase.run` の中でしか流せない。テストは `tools/lint-rules/tests/user-scoped-db.test.ts`（生の `Database` で `FROM options` を書いたクラスを検出する例、許可リストのクラスを通す例、`infra/` の外の `set_config` を検出する例）
2. **マイグレーションのテスト（DB の設定）**: `backend/tests/migrations/rls.test.ts`。最新までマイグレーションした DB の `pg_catalog` を読んで、次を確かめる
   - `public` のすべての表のうち、RLS の対象外の許可リスト（data.md §4。テストの中に表の名前で持つ）にないものは、`relrowsecurity` と `relforcerowsecurity` が true で、`user_id`（users は `id`）が NOT NULL で、`app.user_id` を使うポリシーが USING と WITH CHECK の両方にあること。**新しい表を足して RLS を付け忘れると、ここで落ちる**
   - 許可リストの表は、`ol_app` に SELECT の権限がない（events・auth_attempts）か、利用者のデータを持たない（マスターデータ）こと。許可リストに足すときは、data.md §4 と docs/decisions/ にも理由を書く
   - どの `ol_*` ロールも `rolbypassrls = false` でスーパーユーザーでもないこと。`ol_app` がどの表の持ち主でもないこと。`pg_policies` を読んで、利用者の表ごとに、`ol_app` か `PUBLIC` に当たるポリシーが**ちょうど 1 本**で、その USING と WITH CHECK が `app.user_id` と比べる決まった式（data.md §4）と一致すること（permissive のポリシーは OR で効くので、`true` でなくても 2 本目があれば他人の行が見えうる）。`USING (true)`（または `WITH CHECK (true)`）のポリシーが `ol_migrator`・`ol_cleanup`・`ol_definer`・`ol_incident` 宛てにしかないこと（`PUBLIC` 宛ても許さない）。`pg_has_role('ol_app', r, 'MEMBER')` が、`ol_app` 以外のどの `ol_*` ロールに対しても false であること（ポリシーは `TO` のロールのメンバーにも効く）。`ol_incident` の表の権限が SELECT だけであること。`pg_auth_members` を直接読んで、`ol_migrator`・`ol_cleanup`・`ol_definer`・`ol_incident` へのメンバーシップのうち、`inherit_option` か `set_option` が true のものが、**メンバーが誰であっても**（ログインできるロールでも、できないグループのロールでも、ほかの `ol_*` でも）0 件であること（権限を引き継ぐメンバーも、`SET ROLE` だけができるメンバーも、全員の行を読めるため。`pg_has_role(…, 'USAGE')` は後者を見落とす。グループのロールを間にはさんでも、強いロールへの直接のメンバーシップは必ず 1 本あるので、ここで見つかる）。`admin_option` だけのメンバーシップ（INHERIT も SET もない。PostgreSQL 16 以降でロールを作ったユーザーに自動で付く形）は許す。例外はもう 1 つだけで、`ol_migrator` → `ol_definer` の `set_option` だけ（`inherit_option` は false）を許す（マイグレーションで関数とビューの持ち主を `ol_definer` にする `ALTER … OWNER TO`・作り直しに要る。`ol_migrator` はもともと `USING (true)` を持つので、読める範囲は広がらない。data.md §4）。障害対応の間に `ol_incident` を IAM のユーザーに付けているときは、この検査が落ちるのが正しい（外し忘れの合図）。障害対応で `ol_incident` を付けたまま外し忘れたものを見つけ、CI・確認用・本番のどれでも除外なしで流せる。これらの SQL は `backend/db/checks/rls-checks.sql` にまとめ、マイグレーションのテストと infra:check（process.md §5 の R8・R10b）の両方が使う。`ol_metrics` が `usage_*` のビュー以外を読めないこと。`ol_cleanup` が INSERT・UPDATE を持たないこと。認証の関数が `SECURITY DEFINER` で `search_path` を固定していること。認証の関数を実行できるのが `ol_app` だけであること（`has_function_privilege` で、`PUBLIC` と、`ol_app` と持ち主の `ol_definer` 以外の `ol_*` が false。持ち主は REVOKE しても実行できるので例外にする。`ol_migrator` は INHERIT がないので false のまま。関数は既定で PUBLIC が実行できるので、REVOKE を忘れると、どのロールからでも鍵やコードのハッシュで人を探せてしまう）。`usage_*` のビューを読めるのが `ol_metrics`（と持ち主）だけであること。この 2 つも `rls-checks.sql` に入れる
   - 確認用・本番のログイン用のロール（`ol_<ロール>_<env>`。data.md §4。docs/decisions/0056）も同じ検査で見る。`ol_app_<env>` は `ol_app` と同じく、表の持ち主でなく、`ol_app` のほかの `ol_*` のメンバーでなく、認証の関数を実行してよい。強いロールへのメンバーシップの例外に、`ol_migrator_<env>` → `ol_migrator`・`ol_cleanup_<env>` → `ol_cleanup` の `set_option` だけ（`inherit_option` は false。`<env>` は `staging`・`production` だけ）を足す。各環境の DB の持ち主 `ol_owner_<env>` も強いロールに入れる（例外なし）。ログイン用のロールは表・関数の権限を直接持たない（`env_logins_hold_no_privileges`）。マイグレーションのテストでは、`db:roles:cloud` が作る形のロールをトランザクションの中で作って違反が 0 件のままであること、INHERIT にしたもの・ほかの環境の名前のもの・`ol_app_<env>` を `ol_metrics` のメンバーにしたものが見つかることを確かめる
   - 提案を入れ替えるマイグレーション（`ol_migrator` で流す）が、ほかの人の options の `suggestion_id` も NULL にすること（RLS で黙って 0 行にならない）
   - RLS を直接確かめる: 2 人分の行を入れ、`ol_app` で `app.user_id` を B にしたトランザクションでは、A の行がどの表からも 0 件になること。A の `user_id` で INSERT・UPDATE しようとすると失敗すること。`app.user_id` を設定しないと 0 件になり、一度設定した接続でトランザクションが終わったあと（空文字が返る状態）でもエラーにならず 0 件になること
3. **API の分離テスト（実際の振る舞い）**: `backend/tests/api/isolation.test.ts`
   - `ExpressApp` に登録されたすべてのルート（メソッドとパス）を、記録用のフェイクのルーター（`backend/tests/fakes/RouteRecorder.ts`）で集める。テストの中のケースの表（ルートごとに「他人の行を指定する」か「対象外の理由」を書く）と突き合わせ、**表にないルートがあれば落ちる**。新しいルートを足した PR は、表にも 1 行足す
   - A と B の 2 人分のデータ（項目・達成・写真）を入れ、B の Cookie で、`:id` を取るすべてのルートに A の id（写真は A のファイル名）を指定して、404 になり、A の行が変わっていないこと
   - B の Cookie で一覧系（`GET /api/options`・`GET /api/suggestions` の `optionStatus`・`GET /api/suggestions/:id` の `optionId`）を呼んで、A の id と状態が 1 つも出ないこと
   - `PUT /api/options/order` に A の id を混ぜると 400 になり、A の並びが変わらないこと
   - Cookie なしで、`:id` を取るすべてのルートが 404 になり、一覧が空であること
   - 自分のアカウントだけを扱うルート（`/api/account` の 4 つ）を、その回だけの別の人の Cookie で呼んで、A の users の行（鍵・復旧コードのハッシュ）・項目・達成・写真が変わらないこと（A のコードを知らない人の `restore` は 404）
