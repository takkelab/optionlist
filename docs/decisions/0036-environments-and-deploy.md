# 0036 環境を手元・CI・確認用・本番の 4 つに分け、本番は承認してから出す

- 日付: 2026-11-08
- 状態: 一部置き換え（本番の出し方は → 0055）
- 対象: architecture.md §4、data.md §1、testing.md §0・§6、process.md §5

## 決めたこと
| 環境 | DB | 写真 | 出し方 |
|------|----|------|--------|
| 手元 | Windows に直接入れた PostgreSQL 17（`optionlist`・`optionlist_test`） | `LocalPhotoFiles`（`backend/uploads/`） | `npm run dev` |
| CI | GitHub Actions の `postgres:17` のサービスコンテナ | `LocalPhotoFiles`（一時フォルダ） | push・PR ごと |
| 確認用（staging） | 共用の Cloud SQL の `optionlist_staging` | `optionlist-staging-photos` | main に入ったら自動 |
| 本番（production） | 共用の Cloud SQL の `optionlist_production` | `optionlist-production-photos` | GitHub の Environment `production` で、自分が承認してから |

- デプロイは GitHub Actions から Workload Identity Federation で行う（サービスアカウントの鍵を GitHub に置かない）。イメージは 1 回だけ作り、確認用で確かめたものと同じものを本番に出す
- マイグレーションは、デプロイの前に Cloud Run Job で `ol_migrator` として流す。本番では down を流さない。列を消すとき・名前を変えるときは、「足す → 新旧どちらでも動くコードを出す → 古いものを消す」の 3 回に分ける
- 秘密の値（DB のパスワード、metrics のトークン）は環境ごとに Secret Manager に置く。リポジトリにも GitHub の変数にも置かない
- **本番のデータは確認用にコピーしない**（他人のリストと写真があるため）。確認用のデータは自分で触って作る

## 理由
- マイグレーション、`Secure` の Cookie、HTTPS、入れ物の権限、ドメインのように、本物のクラウドでしか起きない問題を、他人のデータがある本番でいきなり踏まないため
- 確認用の Cloud Run は 0 台まで減らし、DB は共用の 1 台の中に置くので、追加の費用はほぼない（0035）
- 手元の DB を Docker にする案も比べた。Docker Desktop は重く、OneDrive の下のフォルダをマウントすると遅くなったり壊れたりすることがある。CI と本番のメジャーバージョン（17）は自分でそろえる

## 影響
- `npm run infra:check -- <staging|production>` で、各環境の設定（地域、台数、削除保護、バックアップ、入れ物の公開の禁止、サービスアカウントの権限）が決めたとおりかを確かめる（process.md §5 の R8）
- 0010 の「スマホからのアクセス（`dev:lan`）」は手元の開発のためだけに残す。スマホでの確かめは確認用の環境で行う
