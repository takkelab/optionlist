# API と画像の扱い

[SPEC.md](../../SPEC.md) の一部。「※仮決め」の項目は実装しながら変えてよい（変えたら docs/decisions/ に記録する）。

## 1. 共通
- すべて `/api` 配下。リクエスト／レスポンスは JSON（写真のアップロードだけ multipart。§5）
- 画面（frontend のビルド）と API は、同じオリジンから Express が配る（docs/decisions/0035）。CORS は許さない
- JSON のキーは camelCase（DB の列は snake_case。変換は repository で行う）
- エラーは `{ "error": { "code": "VALIDATION_ERROR", "message": "..." } }` の形で返す
- **誰のデータか**は Cookie `__Host-ol_session` で決める（§6）。Cookie がない・無効なときは「アカウントがない人」として扱い、ログイン画面や 401 は返さない（一覧は空、`:id` の指定は 404）
- `GET`・`HEAD` 以外のリクエストは、`Origin` ヘッダーが自分のオリジンと一致しなければ 403 にする。JSON を受け取る API は、`Content-Type` が `application/json` でなければ 400 にする（docs/decisions/0038）
- 他人の行を指定したときは、存在しないときと同じ 404 にする（あるかどうかを見せない）
- 応答には、architecture.md §4 のセキュリティのヘッダーを付ける。API の応答は `Cache-Control: no-store`（写真の配信を除く。§5）

## 2. エンドポイント

| メソッド | パス | 内容 | 成功時 |
|----------|------|------|--------|
| GET | `/api/options?status=pending` | 自分の一覧（`status` は必須。pending は予定日があるものを予定日の早い順、その後に予定日がないもの。同じ日は id 順、予定日なし同士は sort_order 順。completed は completed_at の新しい順）。アカウントがなければ `[]` | 200 `Option[]` |
| POST | `/api/options` | 追加 `{ title, suggestionId? }`。先頭に入る。**アカウントがなければ、ここで作る**（§6） | 201 `Option` |
| GET | `/api/options/:id` | 詳細（達成記録と、提案から追加した項目なら提案の最初の一歩を含む） | 200 `OptionDetail` |
| PATCH | `/api/options/:id` | 更新 `{ title?, status?, plannedOn? }`（少なくとも 1 つ）。`plannedOn` は `null` で消す。completed にすると completed_at を入れ、pending に戻すと completed_at を消して先頭に入れる。status が同じなら両方そのまま | 200 `Option` |
| DELETE | `/api/options/:id` | 削除（達成記録と写真も消す） | 204 |
| PUT | `/api/options/order` | 並び替え `{ ids: number[] }`。自分の pending をこの順に並べ直す（画面は予定日がないものだけを送る。予定日があるものの sort_order は、予定日を消したときに先頭へ置き直す）。`ids` にない pending（画面を読み直す前に別の画面で追加されたもの）は、今の順のまま先頭に残す。書き換えるのは順番が変わった行だけ | 204 |
| POST | `/api/options/:id/achievements` | 達成を記録 | 201 `Achievement` |
| PUT | `/api/achievements/:id/photo` | 達成に写真を付ける（multipart の `photo`。§5）。すでにあれば置き換える | 200 `Achievement` |
| DELETE | `/api/achievements/:id/photo` | 達成の写真を消す。写真がなくても成功 | 204 |
| GET | `/api/photos/<ファイル名>` | 自分の達成の写真を配信（URL は `photoUrl`・`latestPhotoUrl` に入っている。§5） | 200 |
| GET | `/api/suggestions` | 提案の全件（要約）と、テーマ・タグの一覧。季節・一歩の大きさ・タグでの絞り込みは frontend で行う（固定の 100 件前後なので全部返す）。アカウントがなくても読める（`optionStatus` は全部 null） | 200 `SuggestionCatalog` |
| GET | `/api/suggestions/:id` | 提案 1 件（豆知識・最初の一歩・タグ・関連）。関連はタグを共有する提案を、共有するタグの多い順（同じなら id 順）に最大 5 件。自分は含めない | 200 `SuggestionDetail` |
| GET | `/api/account` | 今の端末のアカウントの状態（§6）。アカウントを作らない | 200 `AccountStatus` |
| POST | `/api/account/recovery-code` | 復旧コードを発行する（作り直すと前のコードは使えなくなる）。アカウントがなければ 404 | 201 `RecoveryCode` |
| POST | `/api/account/restore` | 復旧コードで、このアカウントに移る `RestoreRequest`（`{ code, replace? }`）。Cookie を新しい鍵で入れ直す。この端末の別のアカウントのデータが消えるのに `replace` がなければ 409 `RestoreConflict`（§6） | 200 `AccountStatus` |
| DELETE | `/api/account` | すべてのデータ（アカウント・項目・達成・写真）を消し、Cookie も消す。アカウントがなくても成功 | 204 |
| POST | `/api/events` | 利用イベントを保存 `{ events: Event[] }`。`occurredAt` は ISO 8601 の日時。アカウントがなくても受け取る（アカウントは作らない） | 202（本文なし） |
| GET | `/api/metrics` | 実行時メトリクス（Prometheus のテキスト形式）。`Authorization: Bearer <METRICS_TOKEN>` が合わなければ 404（docs/decisions/0038） | 200 |
| GET | `/api/health` | backend の疎通確認 | 200 `{ status: "ok" }` |
| GET | `/api/health/db` | DB の疎通確認。届かないときは §1 のエラー形式ではなく 503 `{ status: "error", message }`。本番と確認用では `message` を返さない | 200 `{ status: "ok" }` / 503 |

## 3. エラー
- 400 `VALIDATION_ERROR`: リクエストの JSON を読めない・大きすぎる・`Content-Type` が違う、一覧の `status` がない・不正、タイトルが空・長すぎる、PATCH に更新する項目がない、予定日が実在する日付でない、`ids` に重複か自分の pending でない option（完了済み・削除済み・他人のもの）がある、イベントの形式違反、写真がない・5MB を超える・画像として読めない・JPEG / PNG / WebP でない、復旧コードの形が違う（data.md §3）
- 403 `FORBIDDEN`: `GET`・`HEAD` 以外で `Origin` が違う（§1）
- 404 `NOT_FOUND`: 存在しない・他人の option / 達成記録 / 写真のファイル、存在しない suggestion（`:id` が正の整数でないものを含む）、合わない復旧コード、アカウントがないのに復旧コードを発行しようとした、どのエンドポイントにも当たらない `/api/*`
- 409 `CONFLICT`: すでに追加済みの提案をもう一度追加しようとした、復旧コードで移るとこの端末の別のアカウントのデータが消えるのに `replace` がない（§6。`localItemCount` を添える）
- 429 `TOO_MANY_REQUESTS`: 回数の制限（§6）を超えた、写真の 1 人あたりの上限（data.md §3）を超えた。`Retry-After` を付ける
- 500 `INTERNAL_ERROR`: 想定外のエラー。共通のエラーハンドラで返し、必ずログ（`kind: unhandled_error`）に出してメトリクスで数える。応答の `message` に内部の情報を入れない

## 4. 型
`shared/types.ts` に一本化し、frontend と backend の両方から `import type` で使う。

```ts
type Option = {
  id: number
  title: string
  status: 'pending' | 'completed'
  suggestionId: number | null
  plannedOn: string | null // 2026-11-23（日付だけ）
  achievementCount: number
  latestPhotoUrl: string | null // 写真が付いた達成のうち、いちばん新しいものの写真
  completedAt: string | null
  createdAt: string
  updatedAt: string
}
type Achievement = { id: number; optionId: number; achievedAt: string; photoUrl: string | null }
// firstStep は追加元の提案の最初の一歩（提案から追加していなければ null）
type OptionDetail = Option & { achievements: Achievement[]; firstStep: string | null }
type SuggestionSize = 'hour' | 'half_day' | 'day' | 'overnight'
type Theme = { id: number; name: string }
type Tag = { id: number; name: string }
// 一覧の行に出すもの。optionStatus はその人がその提案から追加した option の状態（追加していなければ null）
type SuggestionSummary = {
  id: number
  hook: string
  title: string
  size: SuggestionSize
  seasonFrom: number | null // 1〜12。null なら通年
  seasonTo: number | null
  themeId: number
  tagIds: number[] // id 順（SuggestionDetail の tags も id 順）
  optionStatus: Option['status'] | null
}
type SuggestionCatalog = { themes: Theme[]; tags: Tag[]; suggestions: SuggestionSummary[] } // themes は sort_order 順、tags と suggestions は id 順
// optionId はその人がその提案から追加した option の id（追加していなければ null。提案から開くシートで使う）
type SuggestionDetail = SuggestionSummary & { trivia: string; firstStep: string; tags: Tag[]; related: SuggestionSummary[]; optionId: number | null }
// hasAccount: この端末にアカウントがあるか。hasRecoveryCode: 使える復旧コードを発行済みか
type AccountStatus = { hasAccount: boolean; hasRecoveryCode: boolean; createdAt: string | null }
// code は 4 文字ずつハイフンで区切った 16 文字（ABCD-EFGH-JKMN-PQRS）。この応答でしか返さない
type RecoveryCode = { code: string }
// replace: この端末の別のアカウントを消して移ってよいか（確認のあとで true にして送り直す）
type RestoreRequest = { code: string; replace?: boolean }
type Event = {
  type: 'client_error' // screens.md §8
  payload: Record<string, unknown>
  occurredAt: string
}
type ApiError = {
  error: {
    code: 'VALIDATION_ERROR' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'TOO_MANY_REQUESTS' | 'INTERNAL_ERROR'
    message: string
  }
}
// POST /api/account/restore の 409。localItemCount はこの端末のアカウントの項目（options）の件数（確認の文「やりたいこと（N 件）」に出す）
type RestoreConflict = ApiError & { localItemCount: number }
```

- ID は DB では `BIGINT` だが、API では `number` で返す（2^53 を超えるまで使うことはない）

## 5. 画像の扱い
写真は達成記録に付ける。達成 1 回に 1 枚（docs/decisions/0028）。置き場所と配り方は docs/decisions/0037。

- frontend で縮小・圧縮してから、multipart の `photo` で送る（長辺 1280px、JPEG 品質 0.8。canvas を通すので EXIF も消える）※仮決め
- backend は形式（JPEG / PNG / WebP。申告ではなく先頭のバイトで判定）とサイズ（5MB まで）を確かめたうえで、**sharp で作り直す**（向きを直し、長辺 1280px まで縮め、JPEG 品質 80 にし、メタデータをすべて外す）。読めなければ 400。保存するのは作り直したものだけ
- 保存先は `PhotoFiles` の実装で切り替える。手元と CI は `LocalPhotoFiles`（`UPLOAD_DIR`。既定は `backend/uploads/`）、確認用と本番は `GcsPhotoFiles`（`PHOTO_BUCKET` の Cloud Storage の非公開の入れ物）。名前はサーバーで決めた UUID にし、DB にはファイル名と大きさだけ入れる（パストラバーサル対策）
- 保存の前に、1 人あたりの上限（data.md §3）を確かめる。超えるなら 429
- 置き換えは、新しいファイルを書く → 行を更新 → 古いファイルを消す、の順にする。行を更新できなければ、書いたファイルを消す
- multipart はファイル 1 つだけを受け取り、ほかの項目があれば 400 にする
- 配信は `/api/photos/<ファイル名>`。backend が、そのファイル名が**自分の達成の写真か**を DB で（RLS の中で）確かめてから返す。違えば・なければ 404。名前がランダムなことには頼らない
- 配信のヘッダー: `Cache-Control: private, max-age=31536000, immutable`（名前は置き換えのたびに変わる）、`Vary: Cookie`、`Content-Type`（保存した形式）、`X-Content-Type-Options: nosniff`、`Content-Security-Policy: default-src 'none'`、`Content-Disposition: inline`
- 写真を置き換える・消す、option を削除する、アカウントを消すときは、関連する画像ファイルも消す（失敗はログ〈`kind: orphan_file_error`〉とメトリクス `orphan_file_errors_total`。行は消えているので API は成功のまま。残ったファイルは削除のジョブが拾う。data.md §5）
- `backend/uploads/` は git に含めない。テストと E2E は `UPLOAD_DIR` を別のフォルダにする

## 6. アカウントとセッション（docs/decisions/0033）
- Cookie: 名前は `__Host-ol_session`、中身は 32 バイトの乱数を base64url にしたもの。`HttpOnly`・`Secure`・`SameSite=Lax`・`Path=/`、`Max-Age` は 400 日。手元の開発（http）だけは `Secure` を付けられないので、名前を `ol_session` にする
- リクエストごとに、Cookie の鍵の SHA-256 で `auth_find_user`（data.md §4）を呼び、人と `last_seen_at` を決める。見つからなければ「アカウントがない人」
- アカウントを作るのは `POST /api/options` だけ（ほかの書き込みは、すでにある自分の行を指すので、アカウントがなければ 404 か空の結果になる）。作るときは、新しい鍵を作って `auth_create_user` を呼び、`Set-Cookie` で返す
- `auth_find_user` が返した `last_seen_at` が今日（日本時間の日付）でなければ、書いて、Cookie を `Max-Age` 400 日で入れ直す（Chrome は Cookie の期限を最長 400 日に切り詰めるため）
- 復旧コード
  - `POST /api/account/recovery-code`: 新しいコードを作り、ハッシュを `users.recovery_code_hash` に入れ（前のものは上書きで使えなくなる）、平文はこの応答でだけ返す
  - `POST /api/account/restore`: コードを正規化（data.md §3）してハッシュにし、`auth_restore` を呼ぶ。`status` が `ok` なら新しい鍵の Cookie を返し、`not_found` なら 404、`rate_limited` なら 429（`Retry-After`）。そのアカウントを使っていた端末の Cookie は、鍵が変わるので無効になる。今の端末に**別の**アカウントがあれば、移ったあとにその古いアカウントを消す（誰も開けなくなるため）。返った ID が今の端末のアカウントと同じ（自分のコードを自分の端末で入れた）ときは、何も消さない（Cookie だけが新しい鍵になる）
  - 消す前の確認: 本文は `{ code, replace?: boolean }`。`replace` が true でなく、コードが合い、今の端末に**別の**アカウントがあって項目か達成が 1 件以上あるときは、コードを使わずに 409 `CONFLICT`（`{ error: { code: 'CONFLICT', message }, localItemCount: number }`）を返す。画面は確認（screens.md §9）のあとで `replace: true` を付けて送り直す。コードを使わない判定も `auth_restore` の中で行い、回数に数える（data.md §4。関数は `replace` を引数に取り、確認が要るときは `status` を `'needs_confirm'` にして、その端末の件数を数えるために今の人の ID も受け取る）
- 回数の制限（超えたら 429。docs/decisions/0038）※仮決め
  - アカウントの作成: 1 つの IP から 1 時間に 20 件まで（DB の auth_attempts で数える）
  - 復旧コードの入力: 1 つの IP から 1 時間に 10 回まで（同上。合っても合わなくても数える）
  - 写真の保存: 1 アカウント 1 時間に 60 回まで（台ごとのメモリで数える）
  - そのほかの書き込み: 1 アカウント 1 分に 120 回まで（台ごとのメモリで数える）
  - `POST /api/events`: 1 つの IP から 1 分に 20 リクエストまで（台ごとのメモリで数える。アカウントなしでも受け取るので、アカウントではなく IP で数える）
- IP は Cloud Run が付ける `X-Forwarded-For` の右端から取る（Express の `trust proxy` を 1 にする）。DB とアプリが書くログには `IP_HASH_SECRET` で HMAC したものだけを入れる（Cloud Run が自動で残すリクエストのログには IP がそのまま入り、30 日で消える。プライバシーポリシーに書く。docs/decisions/0039）
