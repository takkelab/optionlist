# 0046 他人のデータが見えないことを、lint・マイグレーションのテスト・API のテストで機械的に確かめる

- 日付: 2026-11-08
- 状態: 確定
- 対象: architecture.md §2（L13）、testing.md §1・§7、metrics.md §2

## 決めたこと
- lint の **L13**: repositories で利用者のデータの表を触るクラスは、`UserScopedDatabase`（`forUser(userId)` で作る。トランザクションの中で `SET LOCAL app.user_id` する）だけを受け取る。生の `Database` を使ってよいのは許可リストのクラスだけにする
- マイグレーションのテストで、「RLS の対象外の表」の許可リスト（マスターデータの 4 表、`events`、`auth_attempts`。data.md §4）以外のすべての表について、RLS が有効で強制されていること、`user_id`（users では `id`）が NOT NULL であること、`app.user_id` と比べるポリシーがあることを確かめる。対象外の表は、`ol_app` に SELECT の権限がないか（`events`・`auth_attempts`）、利用者のデータを持たない（マスターデータ）ことを確かめる。あわせて、ロールの権限（どのロールも BYPASSRLS とスーパーユーザーを持たない、`ol_app` が表の持ち主でない、`ol_app`・`PUBLIC` 宛てのポリシーが各表ちょうど 1 本で `app.user_id` と比べる式だけである、`ol_app` がほかの `ol_*` ロールのメンバーでない、`USING (true)` のポリシーが `ol_migrator`・`ol_cleanup`・`ol_definer`・`ol_incident` にしかない、`ol_metrics` がビューしか読めない）も確かめる
- API の分離テスト（`backend/tests/api/isolation.test.ts`）では、登録されたすべてのルートを集めて、ケースの表と突き合わせる。表にないルートがあれば落ちる。ルートごとに、「B が A の id や写真の名前を指定すると 404 になり、一覧に A の行が 1 つも出ない」ことを確かめる
- 分離テストの失敗の件数を metrics.md §2 の指標（0 件。CI 失敗）にする

## 理由
- 文章で「`WHERE user_id` を忘れない」と書いても、AI が書くコードは縛れない（SPEC.md §1.4、process.md §2）。新しい表・新しいルート・新しい repository のどれを足しても、守りを付け忘れたら機械的に落ちる形にする
- 守りを 3 か所に分けたのは、それぞれ見落とすものが違うため。lint は SQL を流す入口を、マイグレーションのテストは DB の設定を、API のテストは実際の振る舞いを見る

## 影響
- architecture.md §2 に L13 を、testing.md に §7 を足す
- 新しいルートを足す PR では、分離テストの表にも 1 行足す必要がある（足さないと CI が落ちる）
