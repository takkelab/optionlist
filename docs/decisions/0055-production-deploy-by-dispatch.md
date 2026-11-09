# 0055 本番へは、GitHub の承認ではなく、自分で手で起動するワークフローで出す

- 日付: 2026-11-09
- 状態: 確定
- 対象: SPEC.md §1.2、architecture.md §4.1、testing.md §6、process.md §5 の R8

## 決めたこと
- 本番へは、`.github/workflows/deploy.yml` を `workflow_dispatch` で自分が起動したときだけ出す。GitHub の Environment `production` の承認（required reviewers）は使わない（0036 の「本番は承認してから出す」を置き換える）
- 本番に出すのは、**確認用の Cloud Run が今動かしているイメージ**で、タグではなくダイジェストで指定する。コミットやタグは選ばせない（確認用で動いていないもの・タグを上書きされたものが本番に出ないため。0036 の「確認用で確かめたものと同じものを本番に出す」はそのまま）
- Workload Identity Federation の条件は、次の claim で縛る
  - 本番のデプロイ用のサービスアカウント: `repository_id`・`repository_owner_id` がこのリポジトリ、`workflow_ref` が `takkelab/optionlist/.github/workflows/deploy.yml@refs/heads/main`、`event_name` が `workflow_dispatch`
  - 確認用のデプロイ用のサービスアカウント（Artifact Registry への書き込みを含む）: 同じ `repository_id`・`repository_owner_id`・`workflow_ref`、`event_name` が `push`
- リポジトリの `GITHUB_TOKEN` の既定の権限は読み取りだけにし、どのワークフローにも `actions: write` を与えない（ほかのワークフローから `workflow_dispatch` を起動させないため）

## 理由
- リポジトリは非公開で、GitHub は無料プラン。非公開のリポジトリでは Environment の required reviewers が使えない（Pro は月 $4）。公開すると、コードと決定記録をすべて見せることになる
- 承認するのは自分 1 人なので、「自分がボタンを押したときだけ本番に出る」で、承認と同じ役目を果たせる
- Environment の承認には、ブランチを書き換えたワークフローから本番に入れないようにする役目もあった。それは上の claim の条件で代わりに防ぐ。`workflow`（表示名）やリポジトリ名は、同じ名前の別のワークフローや取り直したリポジトリと区別できないので使わない
- `workflow_dispatch` は `actions: write` を持つ `GITHUB_TOKEN` からも起動でき、そのときも claim は同じになる。条件だけでは「自分が押した」を保証できないので、トークンの権限で塞ぐ。2026-11-09 の時点で、既定の権限は `read` だった

## 影響
- SPEC.md §1.2、architecture.md §4.1、testing.md §6、process.md §5 の R8 を直した
- `npm run infra:check -- staging`・`production` で、デプロイ用のサービスアカウントの条件と、`GITHUB_TOKEN` の既定の権限・ワークフローに `actions: write` がないことを確かめる（R8）
- 人が増えて承認を分けたくなったら、GitHub Pro にするか公開して Environment に戻すかを、新しい記録で決める
