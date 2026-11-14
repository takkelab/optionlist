# 0063 独自ドメインは optionlist.app で、Cloud Run のドメインマッピング（東京）でつなぐ。R11 は 3 つに分ける

- 日付: 2026-11-14
- 状態: 確定
- 対象: SPEC.md §3、architecture.md §4、process.md §5 の R11、docs/decisions/0035・0045・0057

## 決めたこと
- ドメインは `optionlist.app`（2026-11-14 に取得。期限 2027-11-14、自動更新）。本番は apex の `https://optionlist.app`、確認用は `https://staging.optionlist.app`。`APP_ORIGIN`（`infra/config.ts` の `origin`）もこれ
- つなぎ方は Cloud Run のドメインマッピング（`domains.cloudrun.com/v1`）。asia-northeast1 で作れた。証明書は Google が自動で出す（`AUTOMATIC`）
- gcloud ではマッピングが `beta` にしかないので、監視（0062）と同じく REST で扱う。`npm run infra:setup -- domain <env>` が作り、DNS に書くレコードを表示する。`infra:check -- <env>` がマッピングの向き先・`Ready`・`CertificateProvisioned`・`DomainRoutable` と、DNS が決めたレコードを返すかを確かめる
- DNS は Cloudflare。レコードは手で書き、プロキシはオフ（DNS only）にする
- Cloud Run の URL（`*.run.app`）は消さない。`APP_ORIGIN` と違うので、そこからの書き込みは 403 になる（読むのはできる）
- 死活監視は `origin` の host を見る。host は PATCH で変えられず、アラートのポリシーが指している間は消せないので、`infra:setup` は新しく作り、ポリシーを付け替えてから古い方を消す
- R11 は 3 つの PR に分ける: R11a（ドメインをつなぐ・`docs/ops/launch-checklist.md`）、R11b（1 段目: 自分だけの 2 週間・本番の復旧の訓練）、R11c（2・3 段目: 実機の確認・文面の確定・noindex を外す）

## 理由
- `.com` は取れなかった。`.app` は HSTS のプリロードのドメインで HTTPS しか使えず、もとから HTTPS だけのこのアプリに合う
- 確認用もサブドメインにして、ドメインマッピング・証明書・Origin の確認を本番と同じ形で先に試せるようにした。Cookie は `__Host-` で、ホストごとになるので、確認用と本番は混ざらない
- Cloudflare のプロキシがオンだと、Google の証明書が出ず、Cloud Run の前に別の CDN が入る（0035 の「外のものを挟まない」に反する）
- *.run.app を消す（`--no-default-url`）と、ドメインの問題と Cloud Run の問題の切り分けに使えなくなる。書き込みは Origin の確認で止まる
- 0045 の 3 段階は数週間かかり、1 つの PR では長すぎる

## 影響
- 費用: ドメインの更新料は年 14.2 ドル（月 180 円ほど。初年は 8.2 ドル）。0035 の見込み（月 150〜250 円）の中。ドメインマッピングと証明書は無料
- `infra/config.ts`（`DOMAIN`・`domain`・`origin`・`runUrl`）、`infra/domain.ts`、`infra/setup.ts`（`domain`、死活監視の作り直し）、`scripts/lib/domain-checks.ts`、`deploy.yml` の `ORIGIN`
- process.md の `<確認用のドメイン>`・`<本番のドメイン>` は、ここから独自ドメイン
