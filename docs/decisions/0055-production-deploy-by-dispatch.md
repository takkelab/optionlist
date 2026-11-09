# 0055 本番へは、GitHub の承認ではなく、自分で手で起動するワークフローで出す

- 日付: 2026-11-09
- 状態: 確定
- 対象: SPEC.md §1.2、architecture.md §4.1、testing.md §6、process.md §5 の R8

## 決めたこと
- 本番へは、`.github/workflows/deploy.yml` を `workflow_dispatch` で自分が起動したときだけ出す。GitHub の Environment `production` の承認（required reviewers）は使わない（0036 の「本番は承認してから出す」を置き換える）
- 起動するときは、main のコミット（既定は確認用に出ているもの）を選ぶ。そのコミットで作って Artifact Registry に置いたイメージを、作り直さずにそのまま本番に出す。イメージがなければ止まる
- 本番のデプロイ用のサービスアカウントは、Workload Identity Federation の条件で「このリポジトリの `deploy.yml` を、main から `workflow_dispatch` で起動したとき」にしか使えないようにする。ほかのブランチや push・PR から動いたワークフローは、本番に入れない

## 理由
- リポジトリは非公開で、GitHub は無料プラン。非公開のリポジトリでは Environment の required reviewers が使えない（Pro は月 $4）。公開すると、コードと決定記録をすべて見せることになる
- 承認するのは自分 1 人なので、「自分がボタンを押したときだけ本番に出る」で、承認と同じ役目を果たせる
- Environment の承認には、ブランチを書き換えたワークフローから本番に入れないようにする役目もあった。それは Workload Identity Federation の条件（ref と event）で代わりに防ぐ

## 影響
- SPEC.md §1.2、architecture.md §4.1 の表、testing.md §6、process.md §5 の R8 を直した
- `npm run infra:check -- production` で、本番のデプロイ用のサービスアカウントの Workload Identity Federation の条件を確かめる（R8）
- 人が増えて承認を分けたくなったら、GitHub Pro にするか公開して Environment に戻すかを、新しい記録で決める
