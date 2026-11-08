# 0031 送るイベントを frontend のエラーだけにし、利用状況は既存のテーブルから集計する

- 日付: 2026-11-08
- 状態: 確定（ほかのイベントは要るようになったら足す）
- 対象: SPEC.md §2、screens.md §8、api.md §2・§4、data.md §3、metrics.md §5・§6、testing.md §4・§5

## 決めたこと
- `POST /api/events` で送るのは `client_error`（`{ message, route }`）だけにする。`screen_view`・`suggestion_view`・`suggestion_add`・`suggestion_undo` はやめる（ユーザーの判断）
- `client_error` は `window` の `error`・`unhandledrejection` と、トーストで知らせた失敗（`Notifier.error`。API のほか、コピー・写真の読み込み）で送る。404・409 のように画面で出し分けるものは失敗に数えない。同じメッセージが 10 秒以内に続いたら 1 回にし、1 分に 10 件までにする
- `npm run metrics:usage` は、達成数・提案から追加した件数・初回達成までの日数・滞留を既存のテーブルから、エラー数を events から出す。4 週間の値は 4 で割って週あたりにする。初回達成までの日数は「期間内に初めて達成した option」で数える

## 理由
- 利用者は自分 1 人なので、どの画面に何秒いたか・どこから提案を開いたかは、使っていれば体感でわかる。集計しても判断が変わりにくいのに、計測のコード（ルートの形への変換、来た元を履歴に覚える仕組み、タブを閉じるときの送信）は大きい
- 個人開発でも、エラーの収集はよく入れる。スマホで起きたエラーは開発者ツールで見えないので、記録する価値がある
- 最重要の「週あたりの達成数」は、イベントがなくても `achievements` から数えられる

## 影響
- data.md §3 の「type は 4 種類」は api.md §4 の型（5 種類）と食い違っていたので、「screens.md §8 の種類のみ」に直した
- 性能用データ（metrics.md §1 の events 100,000 件）は件数を変えず、中身を `client_error` にした
- architecture.md §3 から `features/telemetry/` を外した（送るのは AppProviders だけ）
