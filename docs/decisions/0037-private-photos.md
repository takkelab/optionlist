# 0037 写真は非公開の入れ物に置き、backend が持ち主を確かめてから配る。backend でも作り直して EXIF を消す

- 日付: 2026-11-08
- 状態: 確定（上限の値は使って見直す）
- 対象: api.md §2・§3・§5、architecture.md §1・§3、metrics.md §4、testing.md §2・§7

## 決めたこと
- 本番と確認用では、写真を Cloud Storage の非公開の入れ物（均一なアクセス制御、公開アクセスの防止）に置く。`PhotoFiles` の実装として `GcsPhotoFiles` を足し、手元と CI は `LocalPhotoFiles` のままにする
- 配信の URL は今と同じ `/api/photos/<ファイル名>`。backend が「その人の達成の写真か」を DB で確かめ（RLS の中で引く）、違えば 404 にしてから中身を返す。名前がランダムな UUID であることには頼らない
- 配信のヘッダー: `Cache-Control: private, max-age=31536000, immutable`、`Vary: Cookie`、`X-Content-Type-Options: nosniff`、保存した形式の `Content-Type`、`Content-Security-Policy: default-src 'none'`、`Content-Disposition: inline`
- 受け取った写真は、backend で sharp を使って作り直し（長辺 1280px まで、JPEG 品質 80、向きを直してからメタデータをすべて外す）、作り直したものだけを保存する。読めないものは 400
- 1 人あたりの上限は 2,000 枚・合計 1GB にする。写真の保存は 1 人 1 時間に 60 回まで（0038）。超えたら 429

## 理由
- Cloud Run のディスクは、再起動で消える
- 期限つきの署名 URL を返す案も比べた。URL が毎回変わるのでブラウザのキャッシュが効かない。一覧の API が署名のぶん遅くなり、`photoUrl` の持ち方（api.md §4）も変わる。backend を通しても、写真は長辺 1280px（数百 KB）で、数も少ない
- `private` と `Vary: Cookie` にするのは、共有のキャッシュに他人の写真を残さないため。CSP の `default-src 'none'` と nosniff は、写真に見せかけた HTML や SVG をブラウザに実行させないため
- 今は画面側の canvas で EXIF を消している。しかし改造した画面や将来の不具合からは、撮った場所つきの生の写真も届きうる。自宅の位置のような情報を預からないよう、backend でも必ず消す
- 匿名アカウントはいくらでも作れるので、上限がないと保存の費用を勝手に膨らまされる。2,000 枚は、毎日 1 枚付けても 5 年分ある

## 影響
- 0028 の「同じ Wi-Fi の人から写真が見える・変えられる」は、アカウントと持ち主の確認で解決したので閉じる（SPEC.md §3 から消す）
- sharp で作り直す分、アップロードは 50〜150ms ほど遅くなる見込み。metrics.md §4 の「1MB のアップロード p95 300ms 以内」は R5 で測り直し、超えたら新しい記録で見直す
- 写真の消し方（新しいファイル → 行 → 古いファイル。api.md §5）は変えない。入れ物では消したものも 7 日間戻せる（soft delete。0041）
