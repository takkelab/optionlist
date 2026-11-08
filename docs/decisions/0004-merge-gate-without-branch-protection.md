# 0004 ブランチ保護の代わりにマージ用スクリプトで CI を確かめる

- 日付: 2026-11-01
- 状態: 確定
- 対象: process.md §1、SPEC.md 1.4、testing.md §6（「割ったらマージしない」）

## 決めたこと
- マージは `npm run pr:merge -- <PR 番号>`（scripts/merge-pr.ts）で行う。`quality`・`pr-check` の最新の結果がすべて成功のときだけ、確かめたコミットのまま（`--match-head-commit`）マージする
- AI が `gh pr merge` を直接使えないよう、`.claude/settings.json` の permissions.deny に入れる
- リポジトリは private のままにする

## 理由
- private リポジトリの GitHub Free プランでは、ブランチ保護もルールセットも使えない（API が 403 "Upgrade to GitHub Pro or make this repository public"）
- public にすると使えるが、コミットの作者情報に会社のメールアドレスが入っており、社内の規定上も公開してよいか確かめられていない
- GitHub Pro にするほどではないので、スクリプトと AI の権限設定で代わりにする

## 影響
- 人が GitHub の画面からマージすることは止められない。マージするときは必ずスクリプトを使う（process.md §1）
- フルパスの gh.exe を呼ぶなど、deny のパターンに合わない呼び方は止められない
- Pro にする、または public にしたときは、ブランチ保護で `quality`・`pr-check` を必須にし、この記録を置き換える
