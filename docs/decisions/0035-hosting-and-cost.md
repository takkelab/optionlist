# 0035 Cloud Run（東京）＋Cloud SQL（共用の 1 台）＋Cloud Storage に置き、月 3,000 円までに収める

- 日付: 2026-11-08
- 状態: 確定（実額は 0058）
- 対象: SPEC.md §1.2・§1.3、architecture.md §1・§3・§4、metrics.md §5

## 決めたこと
- API は **Cloud Run（asia-northeast1）**。常駐させる台数は 0 にし、最大は 3 台にする。起動時の CPU ブーストを使う
- DB は **Cloud SQL for PostgreSQL（asia-northeast1、最小の共有コア）を 1 台**にし、今後作るアプリと共用する。アプリと環境ごとに DB とロールを分ける（`optionlist_staging`・`optionlist_production`）。削除保護をかける
- 写真は **Cloud Storage（asia-northeast1、非公開）**。Cloud Run のサービスアカウントで読み書きし、鍵のファイルは持たない（0037）
- 画面は **Express がビルド済みの frontend も配る**（同じオリジン）。独自ドメインは Cloud Run のドメインマッピングでつなぐ
- 月の費用の上限は **3,000 円**。予算のアラートを 50・90・100% にする（0042）

## 理由
- API と DB は同じ地域に置く。1 リクエストで SQL を 3 本まで流すので、東京とシンガポールに分かれると、それだけで約 200ms 遅くなる
- Supabase（Pro は月 $25）も比べた。アプリを増やすとプロジェクトごとに月 $10 前後が上乗せされる。Cloud SQL は 1 台に DB をいくつでも作れるので、ユーザーの「別のアプリも同じ値段で置きたい」に合う。Neon の無料枠は、止まったあとの最初の 1 本が遅く、時点復旧の期間も短い
- 匿名アカウントの鍵は Cookie なので、画面と API が別のサイト（`*.pages.dev` と `*.run.app` など）だと Safari が Cookie を捨てる。同じオリジンなら Cookie も CORS も考えなくてよい
- ドメインをつなぐ方法として、外部 HTTPS ロードバランサーは月 $18〜で予算を超える。Firebase Hosting の rewrite は `__session` という名前以外の Cookie を Cloud Run に渡さない。どちらも使わない
- 常駐を 1 台にすると月 1,000 円前後かかり、上限を超えやすい。最初の 1 人が 1〜3 秒待つことは受け入れ、使いながら確かめる（SPEC.md §3）

## 影響
- 費用の目安（月）: Cloud SQL 約 1,800〜2,200 円（ストレージ 10GB、バックアップを含む）、Cloud Run は無料枠の中、Cloud Storage・Artifact Registry・Secret Manager・Cloud Monitoring は合わせて数十円、ドメイン約 150〜250 円。合計 2,000〜2,500 円
- Cloud SQL を共用するので、ほかのアプリの負荷や障害がこのアプリにも響く。性能の目標（metrics.md §4）は CI の Postgres で測る。本番の値は §5 で見る
- ドメインマッピングが asia-northeast1 で使えるかは、R8 で確かめる（SPEC.md §3）
