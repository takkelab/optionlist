# 0002 フォルダ構成と層の分け方

- 日付: 2026-11-01
- 状態: 確定
- 対象: architecture.md §3

## 決めたこと
- backend は controllers → services → repositories → infra の 4 層。テストは unit / api / migrations / perf に分ける
- 型は shared/types.ts に一本化し、`import type` だけで読む
- 「やった」画面は features/options/done/ に置く（独立した feature にしない）

## 理由
- コード設計ルール（クラス＋インタフェース、行数上限、モック禁止）を守ると、routes と repositories の 2 層では処理の置き場がなく、行数上限を超えやすい
- UT だけのカバレッジ（80%）を測るには、テストの種類をフォルダで分ける必要がある
- やったリストは options と同じデータを扱い、詳細画面と完了フローを共有するため

## 影響
叩き台の構成から db/seed.sql をやめ（マスターデータはマイグレーションで入れる）、metrics/・infra/・tools/lint-rules/・scripts/ などを追加した。
