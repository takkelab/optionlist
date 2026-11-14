# 0042 監視は Cloud Monitoring だけで行い、アラートをメールで受け取る

- 日付: 2026-11-08
- 状態: 確定（しきい値は使って見直す。client_error の数え方と細部は 0062）
- 対象: metrics.md §5・§8、architecture.md §4、api.md §6

## 決めたこと
- backend のログは 1 行 1 つの JSON（`severity`・`message`・`kind`・`route`・`status`・`durationMs`）にする。`kind` は `unhandled_error`・`orphan_file_error`・`cleanup_result` などで、ログベースの指標の元にする。ログには Cookie・復旧コード・項目のタイトルを出さない
- アラート（どれもメールで受け取る）
  - 死活監視: 外から `/api/health` を 5 分ごとに叩き、2 回続けて失敗したとき
  - 5xx の割合が 5 分間で 5% を超えたとき
  - `unhandled_error` か `orphan_file_error` のログが 1 件でも出たとき
  - `client_error` が 1 時間に 50 件を超えたとき（1 時間ごとのジョブが数えてログに出す。→ 0062 で、受け取るたびに件数をログに出す形に変えた）
  - 削除のジョブ（0040）とバックアップの書き出し（0041）が失敗したか、26 時間・8 日動いていないとき
  - 予算の 50・90・100%（月 3,000 円。0035）
- `/api/metrics`（prom-client）は残すが、トークンがないと 404 にする（0038）。自分で見たいときだけ使う

## 理由
- Cloud Run の応答時間・5xx・台数は、何もしなくても Cloud Monitoring に出る。小さいうちは無料枠の中で収まる
- Grafana Cloud で `/api/metrics` を集める案も比べた。Cloud Run の台が増えると 1 台ずつの値しか取れず、設定と見る場所も 1 つ増える
- 個人の開発なので、すぐ見られるのはメールだけ。気づくべきことだけを知らせ、多すぎるアラートで見なくなるのを避ける

## 影響
- metrics.md §5 の目標値（p95 100ms 以内など）は、Cloud Monitoring のダッシュボードで週ごとに見る
- PortGuard（0007）は手元の開発だけで使い、本番では使わない（Cloud Run が `PORT` を決める）
