# 0010 frontend の土台（テーマ・アイコン・スマホからのアクセス・E2E の動かし方）（ステップ 4）

- 日付: 2026-11-01
- 状態: 確定（スマホからのアクセスは手元の開発だけに。→ 0036）
- 対象: SPEC.md §3（未決事項）、architecture.md §1・§3・§3.1、testing.md §5、metrics.md §2・§3

## 決めたこと
- カラーテーマは「さわやか系」: 白い背景にティールのアクセント。ライトのみ（ダークモードは作らない）。色は 11 色、文字サイズ 5 種類、余白 6 種類（`frontend/src/styles/tokens.css`）
- アイコンはインライン SVG を `components/Icon.tsx` に自前で持つ。ライブラリは入れない
- スマホからは `npm --prefix frontend run dev:lan`（`vite --host`）で開く。スマホからの API は Vite のプロキシ経由で backend に届くので、backend の設定は変えない
- 提案・やった・詳細の 3 画面は、ステップ 5〜7 までは「準備中」の表示だけ置く（タブと詳細への移動を先に確かめるため）
- frontend の層の向きも `no-restricted-imports` で止める（`features/`・`components/` → `api/`・`axios` を禁止、`api/`・`lib/` → `app/`・`features/`・`components/` を禁止）
- 雛形の疎通確認画面と `HealthApi` は消した（画面から使わない。backend の `/api/health` は E2E の起動待ちに使う）
- E2E の依存（`@playwright/test`・`mysql2`）はルートの package.json に置く。e2e/ は設定・テスト・ページオブジェクトだけで、package.json を持たない（architecture.md §3）
- E2E は Playwright が backend（8100 番、`backend/.env.test` の DB）とビルド済みの frontend（`vite preview`、4174 番）を起動する。Vite のプロキシ先は `BACKEND_URL` で変えられる
- E2E の各テストの前に、`e2e/support/TestData.ts` がテスト用 DB に直接つないでマスターデータ以外を TRUNCATE する
- LCP とタップ領域は `e2e/tests/ui-metrics.spec.ts` が `e2e/results/ui-metrics.json` に書き、`npm run metrics:check`（`scripts/lib/e2e-collector.ts`）が判定する。「不安定なテスト」は retries: 0 で失敗したテストの数。E2E のコマンドが失敗したら最低 1 件にし、LCP とタップ領域は計測できなかった扱い（失敗）にする
- frontend の UT は `src/lib/` のクラスに置き、テストは同じフォルダ（`*.test.ts`）に置く

## 理由
- 「やってもいいし、やらなくてもいい」軽さを出しつつ、落ち着いて毎日見られる色にした（ユーザーの選択）。アクセントは白い文字を載せても読めるよう、コントラスト比 4.5 以上の濃さにした
- 必要なアイコンは 5 個だけで、ライブラリを入れるほどではない。JS サイズ（目標 200KB）にもほぼ影響しない
- 早いうちから実機で UX を確かめたい。なお backend はもともと全インタフェースで待ち受けているので、ファイアウォールで node.exe を許可すると、同じ Wi-Fi の端末から `:8000/api/metrics` などにも届く。これを止めるかは SPEC.md §3 の未決事項のまま（ローカル専用なので今は制限しない）
- 普段の開発のサーバー（8000・5173）を止めずに E2E を流せるよう、ポートを分けた。ビルド済みのものを使うのは、開発サーバーの LCP は変換の時間が乗って本番と違うため
- e2e/ に package.json を分けると、この PC では e2e/ への `npm install @playwright/test` がエラーを出さずに途中で止まり、入らなかった（原因は特定できていない。ルートと一時フォルダでは入る。docs/harness/incidents.md #3）。ルートにまとめれば、インストールも CI の `npm ci` も 1 回で済む
- E2E はブラウザ越しにしか操作しないので、テストの前の状態をそろえるには DB を直接触るのが一番簡単で、通信の差し替え（L3 で禁止）もいらない

## 影響
- `metrics.config.json` の since=4 の指標（E2E の時間、不安定なテスト、LCP、タップ領域）が計測されるようになった。目標値は変えていない
- CI で Chromium のインストール（`npx playwright install --with-deps chromium`）を足し、ジョブの時間の上限を 20 分から 30 分にした
