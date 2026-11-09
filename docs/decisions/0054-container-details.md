# 0054 本番用のコンテナの細部（tsx で実行・FRONTEND_DIST・スモークテスト・image ジョブ）

- 日付: 2026-11-09
- 状態: 確定
- 対象: architecture.md §4.2・§4.3、testing.md §5・§6、process.md §1・§5 R7

## 決めたこと
- イメージの中の backend は、ビルドせず **tsx で TypeScript のまま動かす**（`node --import tsx src/server.ts`）。tsx は backend の `dependencies` に移す
- 画面を配るかは **`FRONTEND_DIST`**（ビルド済みの frontend のフォルダ）で決める。なければ配らない（手元の `npm run dev` は Vite が配り、API テストも今のまま）。イメージは `/app/frontend/dist` を入れておく。`index.html` がなければ起動の時点で止まる
- キャッシュは、`/assets/` の下（Vite が名前にハッシュを付けるもの）だけを `immutable` にし、それ以外（`index.html`・`sw.js`・`registerSW.js`・manifest・アイコン・`workbox-*.js`）は `no-cache`。`/index.html` を直接開かれても、noindex の meta を差し込んだものを返す。`/assets/` の下でファイルがなければ `index.html` ではなく 404 にする（新しい版を出したあと、古いタブが消えたチャンクを読みに来ると、HTML が 200 の JS として返り、SW の通信優先のキャッシュ〈0052〉にもそのまま残るため）
- 画面のヘッダーを付けない「API」は `/api` と `/api/…`（app.ts の `/api` の 404 と同じ範囲）
- 画面のセキュリティのヘッダーは API 以外の応答に付ける。`X-Robots-Tag: noindex` は `/api` を含むすべての応答に付ける
- スモークテスト（`npm run smoke:image -- <イメージ>`）は `APP_ENV=production` でコンテナを起動し、テスト用 DB に `ol_app` でつなぐ。接続先の `localhost`・`127.0.0.1` は `host.docker.internal` に向け直し、`docker run --add-host=host.docker.internal:host-gateway` を付ける。`PHOTO_BUCKET` は起動に要るので名前だけ渡す（写真には触らない）
- CI に `image` ジョブを足し、`npm run pr:merge` の必須のチェックを `quality`・`pr-check`・`image` にする
- E2E は vite preview をやめ、backend（8100）が画面も配る。4174 番は使わなくなった。CSP の違反がないことは `csp.spec` で確かめる

## 理由
- backend の import は拡張子を書かない（`moduleResolution: bundler`）ので、Node の型の除去ではそのまま動かない。tsc 7 で JS を書き出す・esbuild でまとめる形にすると、ビルドの設定と、テスト（tsx）と本番で動くものが分かれる。手元・テスト・本番で同じ tsx にそろえるほうが変更が小さい。起動が数百 ms 遅くなるのは、最小 0 台の Cloud Run のコールドスタート（1〜3 秒。0035）の中に収まる
- 環境変数で切り替えると、テストは一時フォルダの偽の dist で配信を確かめられ、画面を配らない普段の開発も壊れない
- `/assets/` 以外にも名前にハッシュの付くもの（`workbox-*.js`）はあるが、数が少なく小さいので `no-cache` のままでよい。名前で見分ける正規表現を持つより、Vite の出力先で分けるほうが確か
- スモークテストを `--network host` にすると Linux でしか動かない。`host.docker.internal` なら CI（Linux）と手元の Docker Desktop の両方で同じ手順で流せる
- `quality` にイメージのビルドを足すと 30 分の枠を圧迫するので、別のジョブにして並べて流す

## 影響
- 新規: `Dockerfile`・`.dockerignore`・`backend/src/middleware/FrontendFiles.ts`・`ScreenHeaders.ts`・`scripts/smoke-image.ts`・`scripts/lib/image-smoke.ts`・`backend/tests/api/frontend-files.test.ts`・`e2e/tests/csp.spec.ts`
- 変更: `infra/AppConfig.ts`（`FRONTEND_DIST`・`PUBLIC_INDEXING`）、`app.ts`（`trust proxy`）、`server.ts`（確認用・本番で PortGuard を使わない）、`e2e/playwright.config.ts`、`.github/workflows/ci.yml`、`scripts/merge-pr.ts`
- マイグレーションの Job（dbmate）をこのイメージで流すかは R8 で決める
