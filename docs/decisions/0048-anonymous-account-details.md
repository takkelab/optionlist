# 0048 匿名アカウントとデータの分離の細部（R2 の範囲、ロールの作り方、2 つの指標）

- 日付: 2026-11-08
- 状態: 確定
- 対象: process.md §5（R2・R3・R5）、data.md §4、testing.md §0・§7、architecture.md §4.2、metrics.md §2（`metrics.config.json`）

## 決めたこと
- 認証の関数は、R2 では `auth_find_user`・`auth_create_user` だけを作る。`auth_restore` は、使う `POST /api/account/restore` と復旧コードの入力の回数の制限と一緒に R3 で作る
- 写真の配信で持ち主を確かめる部分（`GET /api/photos/:filename` で、そのファイル名が自分の達成の写真かを RLS の中で確かめてから返す。`private`・`Vary: Cookie`）は、R5 から R2 に前に出す。Cloud Storage・sharp・上限は R5 のまま
- ロールはクラスタ全体のものなので、マイグレーションではなく `db:roles`（superuser の `ADMIN_DATABASE_URL`）で作る。同じスクリプトが、マイグレーションを流す DB を `ol_migrator` の持ち物として作る
- 手元と CI の `ol_migrator` には CREATEDB を付ける。確認用・本番で付けるかは R8 で決める
- `metrics.config.json` に、metrics.md §2 の「他人のデータが見えること」（`tenant-isolation-failures`。`tests/api/isolation.test.ts` の失敗の数）と「RLS の付け忘れ」（`rls-missing-tables`。`tests/migrations/rls.test.ts` の「RLS coverage」の失敗の数）を足す。どちらも 0 件で CI 失敗。結果がない・ケースが 0 件なら未計測（missing）にする
- 手元の開発用 DB（`optionlist`）は、空から作り直した（ユーザーの判断）
- `auth_create_user` は、作れたときだけ auth_attempts に 1 行入れる（断った試行は数えない）。数える前に IP ごとのアドバイザリロックを取る。data.md §4 の「どちらでも 1 行入れる」を直した
- `db:roles:test` は、テスト用 DB を持ち主にかかわらずいつも作り直す（data.md §4 のとおり。testing.md §0 の「持ち主でなければ作り直す」を直した）
- 組み立て（controllers・services・repositories の new）を `src/AppAssembly.ts` に移し、`server.ts` とテストの `TestApp` が同じものを使う

## 理由
- 断った試行: 数えると、断られて試し直すたびに 1 時間の窓が延びる。`Retry-After` のとおりに試し直しても、また断られる。1 つの IP を共有する場所（学校・携帯回線）では、新しい人がいつまでも作れなくなる。上限は「作ったアカウント」の数（api.md §6）なので、作れなかった試行を入れる理由がない。復旧コードの入力（R3）は、外れた試行を数えるのが目的なので、どの結果でも 1 行入れるまま
- アドバイザリロック: 数えてから入れるまでの間に同じ IP から別のリクエストが来ると、どちらも 19 件と数えて上限を超える
- テスト用 DB の作り直し: 新しいマイグレーションがある別のブランチでテストしたあとに戻ると、dbmate の up は知らないマイグレーションの表や列を消さないので、余分な表が残ったまま API テストが流れる
- 組み立て: 分離テストは、登録されたルートの一覧を `TestApp` から集める。`TestApp` が `server.ts` の写しだと、新しい controller を `server.ts` にだけ足したとき、そのルートが分離テストの表から漏れても指標が 0 のまま通る
- `auth_restore`: 使う API がない関数を先に作ると、R2 のテストで振る舞いを確かめる手段がなく、R3 で API と一緒に直すことになる。R2 の完了の条件にも入っていない
- 写真: R2 の完了の条件の `isolation.spec`（testing.md §5 の 11。B が A の写真の URL を開くと 404）と、分離テストのケースの表（写真のルート）が、持ち主の確認がないと通らない。名前がランダムなことに頼らない（0037）のは、一般公開の前から守りたい
- ロール: マイグレーションで `CREATE ROLE` すると、Cloud SQL では superuser になれず、マイグレーションのテストで DB を作り直すたびにクラスタ全体のロールを触ることになる。DB を `ol_migrator` の持ち物にするのは、`POSTGRES_DB` などで superuser が作った DB では、表の持ち主が `ol_migrator` にならないため
- CREATEDB: マイグレーションのテスト（testing.md §1）が `<テスト用 DB 名>_migrations` を消して作り直す。DB を消すには持ち主であること、作るには CREATEDB が要る
- 指標: 分離テストの表にないルートを「ケースがある」の 1 件の失敗として数えるので、新しいルートを足して表を直し忘れても 1 件以上になる（0046）
- 開発用 DB: options・achievements に `user_id` の NOT NULL を足すので、持ち主のない既存の行は残せない。本番も空から始める（0044）

## 影響
- `backend/db/roles/`、`backend/db/checks/rls-checks.sql`、`backend/db/migrations/20261108120000_users_and_rls.sql`、`backend/src/AppAssembly.ts`
- `backend/.env.example`・`.env.test.example` に `ADMIN_DATABASE_URL`・`APP_DATABASE_URL`・`IP_HASH_SECRET`。`DATABASE_URL` は `ol_migrator`
- `.github/workflows/ci.yml`（`POSTGRES_DB` をやめ、`db:roles:test` を流す）
- `scripts/lib/command-collector.ts`（vitest の JSON の結果から 2 つの指標を数える）。backend の `test:coverage` も JSON の結果を `coverage/all/results.json` に書く
