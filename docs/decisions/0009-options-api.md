# 0009 options の API と性能テストの仕組み（ステップ 3）

- 日付: 2026-11-01
- 状態: 確定
- 対象: api.md §2・§3、data.md §2（sort_order）、testing.md §3、metrics.md §4

## 決めたこと
- `GET /api/options` の `status` は必須（ない・不正は 400）。`:id` が正の整数でなければ 404
- `PATCH` は `title`・`status` の少なくとも一方が必要。completed にするときは sort_order を変えない。status が変わらなければ completed_at と sort_order は触らない
- 並び替え（`PUT /api/options/order`）は、順番が変わった行の sort_order だけを書き換える。新しい並びのうち今の sort_order の順のままでよい最長の部分（最長増加部分列）は残し、残りの行に前後の値の間の値を入れる。先頭・末尾は 1,024 の隙間を空ける。間に入る整数がないときだけ全件を 1,024 刻みで振り直す（`services/SortOrderPlanner.ts`）
- `ids` にやりたいリストの全件がそろっていなくても受け付ける。`ids` にない pending は今の順のまま先頭に残し、そのあとに `ids` の順で並べる。重複・完了済み・存在しない id は 400
- 先頭への追加とやりたいリストへ戻すときは、data.md の「最小値 − 1」を「最小値 − 1,024」に変えた（pending がなければ 0）
- 提案の二重追加（UNIQUE 違反）は 409、存在しない提案（外部キー違反）は 404。repository で `AppError` に変える
- `suggestionId` が INT UNSIGNED の上限（4,294,967,295）を超えるときも、存在しない提案として 404 にする（入力検証で止める。MySQL は範囲外の値を外部キー違反ではなく範囲外のエラーで返すため）
- タイトルの長さはコードポイントで数える（絵文字 1 個 = 1 文字）。前後の空白には全角スペース（U+3000）も含める
- **画像ファイルの削除はステップ 8 で入れる**。ステップ 3 の DELETE は DB の行だけを消す（メモ・達成記録は ON DELETE CASCADE）。`UPLOAD_DIR` と `orphan_file_errors_total` もステップ 8 で入れる
- 性能テストは `npm run test:perf`（性能用データを入れてから `vitest.perf.config.ts` で流す）。結果は `backend/coverage/perf/results.json` に書くだけで、目標値との比較と 1 回の測り直しは `npm run metrics:check`（`scripts/lib/perf-collector.ts`）が行う。metrics.md §4 の「2 回とも割ったら失敗」は指標ごとに見る（どちらかの回で目標を満たした指標は合格）。テストのコマンド自体が失敗したときは測り直さない
- 性能テストは backend を vitest のワーカーの中で listen して、fetch で 1 本ずつ送る。SQL の本数と時間は Database を包むクラス（`tests/fakes/CountingDatabase.ts`）で数える。ヒープの増加も同じワーカーの中で、GC してから比べる
- RSS だけは、本物の `src/server.ts` を別のプロセスで起動し、その `/api/metrics` の `process_resident_memory_bytes` を毎回読んで最大値を取る（`tests/fakes/BackendProcess.ts`）
- backend は Node のオプション `--max-semi-space-size=4` で起動する（`npm run dev`・`start` と性能テスト。2 か所が同じことは性能テストが確かめる）
- フルテーブルスキャンの検出（EXPLAIN）は SELECT・UPDATE・DELETE だけを見る
- completed の一覧（completed_at の新しい順）用の索引は足さない（EXPLAIN でフルスキャンにならなかった）

## 理由
- 並び替えで pending 全件（500 件）を毎回書き換えると、SQL 1 本で約 17〜25ms かかり、SQL の p95（10ms）を割った。FIELD・CASE・JSON_TABLE との JOIN のどれでも差がなく、時間の大半は行と索引 `(status, sort_order)` の更新だった。画面の操作は 1 件のドラッグなので、変わった行だけを書けば普段は 1 行で済む
- PC とスマホから使うので、片方の画面が古いまま並び替えることがある（例: スマホで追加した直後に、読み直していない PC でドラッグする）。全件の一致を求めて 400 にすると、ドラッグがやり直しになる。追加されたものは画面にまだ出ていないので、先頭（追加したときの位置）に残すのが自然。完了・削除されたものは画面に残っているので、400 で読み直させる
- 先頭に「最小値 − 1」で入れると、最近追加したものどうしの値が連続し、それらを並び替えるたびに全件の振り直しになる。隙間を空ければ、普段の並び替えは 1 行の更新で済む
- 判定と測り直しを metrics:check 側に置くと、目標値を metrics.config.json だけで管理でき、測り直しの規則（metrics.md §4）もスクリプトのテストで確かめられる
- 画像付きメモはステップ 8 まで作れない。ファイル削除だけを先に入れても、テストのために DB とファイルを手で用意することになり、multer・`UPLOAD_DIR` とまとめて入れるほうが確かめやすい
- RSS はプロセス全体の値なので、ワーカーの中で測ると、テスト側の fetch や応答の解析の分が乗る（同じ条件で 117MB・176MB・290MB とぶれた）。別プロセスの server.ts で測ると、backend だけの値になる
- 別プロセスで測っても、既定の Node のオプションでは RSS が 235〜258MB になり、目標（200MB）を割った。GC 後のヒープ増加は 0.4〜1.2MB でリークではなく、若い世代のヒープを V8 が広げていた（ヒープの確保量 191MB に対して使用量 60〜90MB）。連続 1,000 リクエストで比べると、`--max-old-space-size=64` は RSS 144MB で 1.3 倍遅く、`--max-semi-space-size=4` は RSS 126MB で速さが変わらなかった
- INSERT … SET の EXPLAIN は表を読まないのに `type = ALL` を返すので、数えると誤検出になる

## 影響
- api.md §5 の「option を削除したら画像ファイルも消す」は、ステップ 8 までは実装されていない
- `backend/package.json` の `dev`・`start` に `--max-semi-space-size=4` を付けた。性能テストでの RSS は 136MB（目標 200MB）
