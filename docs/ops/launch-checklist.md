# 公開のチェックリスト（docs/decisions/0045・0063。process.md §5 の R11）

終わったものを `- [x]` にし、日付と結果（確かめたコマンドや、届いたメールの件名）を後ろに書く。R11 は、ここに `- [ ]` が残っていない（`grep -c -F -- "- [ ]" docs/ops/launch-checklist.md` が 0）ことで終わる。

## 0. 準備（R11a）
- [ ] `https://staging.optionlist.app` と `https://optionlist.app` で `/api/health` が `{"status":"ok"}`（ドメインマッピングと証明書。docs/decisions/0063）
- [ ] `npm run infra:check -- staging`・`production` が終了コード 0（マッピング・DNS・`APP_ORIGIN`・死活監視の host）
- [ ] 確認用の独自ドメインで、手で 1 件追加できる（Origin の確認が通る）

## 1. 自分だけ（2 週間。R11b）
- [ ] 本番の独自ドメインで、自分の日常で 2 週間使う（始めた日と終えた日を書く）
- [ ] 削除のジョブ（`optionlist-production-cleanup`）が毎日 4 時に流れ、消した件数のログが出ている（data.md §5）
- [ ] 週 1 の書き出し（`optionlist-production-backup`）が日曜 5 時に流れ、入れ物に書き出しのファイルがある（data.md §6）
- [ ] 本番のアラートのメールが 1 回以上届くことを確かめた（metrics.md §8）
- [ ] 本番で復旧の訓練（`npm run ops:restore-drill -- production`）が成功し、`docs/ops/restore-drills.md` に行がある。終わったあと `restore-drill-*` のインスタンスが残っていない（data.md §6）
- [ ] `npm run metrics:usage -- --env production` が自分の利用を数える（metrics.md §6）

## 2. 知人数人（R11c）
- [ ] 想定ユーザーに近い人に URL を渡した（人数と日付を書く）
- [ ] iPhone の Safari: 最初の追加でアカウントができる
- [ ] iPhone のホーム画面に追加したアプリ: Safari と同じアカウントのまま使えるか（iOS の版も書く）。使えなければ復旧コードで移れる。別のアカウントになるなら screens.md §9 と docs/decisions/ を直す（0045）
- [ ] Android の Chrome: 最初の追加でアカウントができ、ホーム画面に追加しても使える
- [ ] 復旧コードで別の端末に移ると、古い端末が切れる
- [ ] すべてのデータを消せる

## 3. 一般公開（R11c）
- [ ] プライバシーポリシー・利用規約の文面を確定した（docs/decisions/0052）
- [ ] ポリシーの仮の問い合わせ先を、専用のアドレスに差し替えた（`git grep -n "example.invalid" -- frontend/src` が 0 件）
- [ ] 本番を `PUBLIC_INDEXING=true` にし、`curl -sI https://optionlist.app/ | grep -ci "x-robots-tag"` と `curl -s https://optionlist.app/ | grep -c noindex` が 0
