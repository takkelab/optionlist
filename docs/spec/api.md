# API と画像の扱い

[SPEC.md](../../SPEC.md) の一部。「※仮決め」の項目は実装しながら変えてよい（変えたら docs/decisions/ に記録する）。

## 1. 共通
- すべて `/api` 配下。リクエスト／レスポンスは JSON（写真のアップロードだけ multipart。§5）
- JSON のキーは camelCase（DB の列は snake_case。変換は repository で行う）
- エラーは `{ "error": { "code": "VALIDATION_ERROR", "message": "..." } }` の形で返す

## 2. エンドポイント

| メソッド | パス | 内容 | 成功時 |
|----------|------|------|--------|
| GET | `/api/options?status=pending` | 一覧（`status` は必須。pending は予定日があるものを予定日の早い順、その後に予定日がないもの。同じ日は id 順、予定日なし同士は sort_order 順。completed は completed_at の新しい順） | 200 `Option[]` |
| POST | `/api/options` | 追加 `{ title, suggestionId? }`。先頭に入る | 201 `Option` |
| GET | `/api/options/:id` | 詳細（達成記録と、提案から追加した項目なら提案の最初の一歩を含む） | 200 `OptionDetail` |
| PATCH | `/api/options/:id` | 更新 `{ title?, status?, plannedOn? }`（少なくとも 1 つ）。`plannedOn` は `null` で消す。completed にすると completed_at を入れ、pending に戻すと completed_at を消して先頭に入れる。status が同じなら両方そのまま | 200 `Option` |
| DELETE | `/api/options/:id` | 削除（達成記録も消す） | 204 |
| PUT | `/api/options/order` | 並び替え `{ ids: number[] }`。pending をこの順に並べ直す（画面は予定日がないものだけを送る。予定日があるものの sort_order は、予定日を消したときに先頭へ置き直す）。`ids` にない pending（画面を読み直す前に別の端末で追加されたもの）は、今の順のまま先頭に残す。書き換えるのは順番が変わった行だけ | 204 |
| POST | `/api/options/:id/achievements` | 達成を記録 | 201 `Achievement` |
| PUT | `/api/achievements/:id/photo` | 達成に写真を付ける（multipart の `photo`。§5）。すでにあれば置き換える | 200 `Achievement` |
| DELETE | `/api/achievements/:id/photo` | 達成の写真を消す。写真がなくても成功 | 204 |
| GET | `/api/photos/<ファイル名>` | 写真のファイルを配信（URL は `photoUrl`・`latestPhotoUrl` に入っている） | 200 |
| GET | `/api/suggestions` | 提案の全件（要約）と、テーマ・タグの一覧。季節・一歩の大きさ・タグでの絞り込みは frontend で行う（固定の 100 件前後なので全部返す） | 200 `SuggestionCatalog` |
| GET | `/api/suggestions/:id` | 提案 1 件（豆知識・最初の一歩・タグ・関連）。関連はタグを共有する提案を、共有するタグの多い順（同じなら id 順）に最大 5 件。自分は含めない | 200 `SuggestionDetail` |
| POST | `/api/events` | 利用イベントを保存 `{ events: Event[] }`。`occurredAt` は ISO 8601 の日時 | 202（本文なし） |
| GET | `/api/metrics` | 実行時メトリクス（Prometheus のテキスト形式） | 200 |
| GET | `/api/health` | backend の疎通確認 | 200 `{ status: "ok" }` |
| GET | `/api/health/db` | DB の疎通確認。届かないときは §1 のエラー形式ではなく 503 `{ status: "error", message }` | 200 `{ status: "ok" }` / 503 |

## 3. エラー
- 400 `VALIDATION_ERROR`: リクエストの JSON を読めない・大きすぎる、一覧の `status` がない・不正、タイトルが空・長すぎる、PATCH に更新する項目がない、予定日が実在する日付でない、`ids` に重複か pending でない option（完了済み・削除済み）がある、イベントの形式違反、写真がない・5MB を超える・JPEG / PNG / WebP でない
- 404 `NOT_FOUND`: 存在しない option / suggestion / 達成記録 / 写真のファイル（`:id` が正の整数でないものを含む）、どのエンドポイントにも当たらない `/api/*`
- 409 `CONFLICT`: すでに追加済みの提案をもう一度追加しようとした
- 500 `INTERNAL_ERROR`: 想定外のエラー。共通のエラーハンドラで返し、必ずログに出してメトリクスで数える

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
// 一覧の行に出すもの。optionStatus はその提案から追加した option の状態（追加していなければ null）
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
// optionId はその提案から追加した option の id（追加していなければ null。提案から開くシートで使う）
type SuggestionDetail = SuggestionSummary & { trivia: string; firstStep: string; tags: Tag[]; related: SuggestionSummary[]; optionId: number | null }
type Event = {
  type: 'client_error' // screens.md §8
  payload: Record<string, unknown>
  occurredAt: string
}
type ApiError = { error: { code: 'VALIDATION_ERROR' | 'NOT_FOUND' | 'CONFLICT' | 'INTERNAL_ERROR'; message: string } }
```

## 5. 画像の扱い
写真は達成記録に付ける。達成 1 回に 1 枚（docs/decisions/0028）。

- frontend で縮小・圧縮してから、multipart の `photo` で送る（長辺 1280px、JPEG 品質 0.8。canvas を通すので EXIF も消える）※仮決め
- backend は形式（JPEG / PNG / WebP。申告ではなく先頭のバイトで判定）とサイズ（5MB まで）を確かめ、`UPLOAD_DIR`（既定は `backend/uploads/`）にサーバーで決めた名前で保存する。DB にはファイル名だけ入れる（パストラバーサル対策）
- 置き換えは、新しいファイルを書く → 行を更新 → 古いファイルを消す、の順にする。行を更新できなければ、書いたファイルを消す
- multipart はファイル 1 つだけを受け取り、ほかの項目があれば 400 にする
- 配信は `/api/photos/<ファイル名>`。名前は置き換えのたびに変わるので、長くキャッシュさせる。`X-Content-Type-Options: nosniff` を付ける
- 写真を置き換える・消す、option を削除するときは、関連する画像ファイルも消す（失敗はログとメトリクス `orphan_file_errors_total`。行は消えているので API は成功のまま）
- `backend/uploads/` は git に含めない。テストと E2E は `UPLOAD_DIR` を別のフォルダにする
