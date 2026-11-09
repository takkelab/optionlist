# 0051 写真を Cloud Storage へ移すときの細部（R5）

- 日付: 2026-11-09
- 状態: 確定（上限と回数の制限の値は 0037 のとおり、使って見直す）
- 対象: api.md §3・§5・§6、data.md §2・§3、architecture.md §4.1・§4.2、testing.md §2・§6、screens.md §7

## 決めたこと
- 写真の 1 人あたりの上限の 429 は、回数の制限と別のコード **`PHOTO_LIMIT_REACHED`** にし、`Retry-After` を付けない。画面は「写真はこれ以上保存できません」と出す（回数の制限の 429 は「少し時間をおいてから、もう一度お試しください」）
- 配信は `sendFile` をやめ、`PhotoFiles.read(name)` で中身を読んで返す（`LocalPhotoFiles`・`GcsPhotoFiles` で同じ形）。`PhotoFiles` は `save(bytes)`・`read(name)`・`remove(name)` だけにし、保存する名前はいつも `<UUID>.jpg`
- 確かめる順番は、形式（400）→ 達成があるか（404）→ sharp での作り直し（400）→ 上限（429）→ 保存。上限は保存の前に読むだけで判定する（同時の保存で 1 枚超えうるが、保存の回数の制限で抑える）。置き換える写真は数えない
- sharp は `limitInputPixels` を 5,000 万画素にする。`failOn` は `"error"`（既定の `"warning"` より緩い）にし、途中で切れた JPEG のような警告だけのものは読み、読めないものだけ 400 にする
- 置き換え・削除で消す古いファイルの名前は、行を更新する SQL の中で、行を `FOR UPDATE` で押さえてから読む（`UPDATE … FROM (SELECT … FOR UPDATE) RETURNING`）
- 写真の保存（`PUT /api/achievements/:id/photo`）は、そのほかの書き込みの枠（1 分 120 回）に加えて、写真の枠（1 時間 60 回）でも数える
- `achievements.photo_bytes` を足し、名前と大きさが一緒に NULL か値を持つ CHECK を付ける。マイグレーションの前からある写真の行は 0 にする
- 確認用・本番（`APP_ENV` が staging / production）では `PHOTO_BUCKET` を必須にし、なければ起動を止める
- `GcsPhotoFiles` のテストは fake-gcs-server（`fsouza/fake-gcs-server:1.52.2`）につなぐ。CI はサービスコンテナではなく `docker run`（`npm --prefix backend run gcs:emulator`）で起動する。手元で `STORAGE_EMULATOR_HOST` がなければ GCS の分を飛ばし、CI（`CI` がある）では飛ばさずに失敗にする

## 理由
- 上限は、待っても解けない（写真を消すまで続く）。`Retry-After` を付けると、待てば保存できるように見える。コードを分けないと、画面が 2 つの 429 を見分けられない
- `sendFile` はディスクのファイルにしか使えない。写真は長辺 1280px（数百 KB）なので、メモリに読んで返しても困らない。2 つの実装の形をそろえると、同じテストで確かめられる
- 順番: 安い確かめを先にする。他人の・ない達成に対して sharp を回さない（作り直しは 50〜150ms かかる）。上限は作り直した後の大きさで数えるので、作り直しのあと
- `failOn`: 撮ったスマホや転送の途中でわずかに壊れた写真も、見られるなら残したい。画素は作り直すので、警告の残りを保存することはない
- `FOR UPDATE`: 前の名前を別のトランザクションで読むと、同じ達成に 2 本同時に送られたとき、どちらも同じ古い名前を消し、片方の新しいファイルがどの行からも指されずに残った（reviewer の指摘）。削除のジョブ（R9）が拾うまで容量を使い、上限にも数えられない
- 解凍爆弾: 小さなファイルでも、展開すると何 GB にもなる画像がある。sharp の既定（約 2.7 億画素）では Cloud Run のメモリ（512MB）を使い切りうる。スマホの写真は 5,000 万画素までに収まる
- 写真の枠を別にするのは、アップロードが重い（sharp と Cloud Storage）ので、ほかの書き込みより少ない回数で止めるため
- 0 で埋めるのは、手元の DB にしか写真の行がないため（利用者のデータはまだない。0044）。上限の判定が少し甘くなるだけ
- `PHOTO_BUCKET` を必須にしないと、設定を忘れたとき、写真が Cloud Run のディスクに黙って置かれ、再起動で消える
- GitHub Actions のサービスコンテナは、起動の引数（`-scheme http` など）を渡せない。既定の https は自己署名の証明書なので、つなぐ側で証明書の確認を外すことになる。手元で Docker を起動していないときに `npm test` 全体を止めないよう、手元だけは飛ばす（ユーザーと相談して決めた）

## 影響
- backend: `repositories/PhotoFiles.ts`・`GcsPhotoFiles.ts`・`LocalPhotoFiles.ts`・`AchievementRepository.ts`、`services/PhotoRebuilder.ts`・`AchievementPhotoService.ts`・`errors.ts`、`controllers/AchievementPhotoController.ts`、`middleware/ApiGuards.ts`・`WriteRateLimit.ts`、`infra/AppConfig.ts`、`server.ts`、`AppAssembly.ts`、マイグレーション `20261109030405_photo_bytes.sql`、性能用データ
- frontend: `api/client.ts`（`PhotoRefusedError`）、`lib/OptionListActions.ts`
- テスト: `tests/api/photo-files-contract.test.ts`（新規）、`tests/unit/photo-rebuilder.test.ts`（新規）、`tests/fakes/TestImages.ts`（本物の画像。偽の JPEG は sharp で 400 になる）、`FakePhotoRebuilder.ts`
- CI: `.github/workflows/ci.yml` に fake-gcs-server の起動と `STORAGE_EMULATOR_HOST`
