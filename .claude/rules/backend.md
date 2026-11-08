---
paths:
  - "backend/**"
---
- SQL は必ずプレースホルダ（`db.query("... WHERE id = $1", [id])`）を使う。文字列連結・テンプレート文字列で値を埋め込まない
- ルートは `src/controllers/` のクラス（`Controller` を実装）に書き、パスは `/api/...` から書く。`src/AppAssembly.ts` で new して `ExpressApp` に渡す（server.ts とテストの TestApp が同じ組み立てを使う）
- エラーは `services/errors.ts` の `AppError` を投げる。応答は共通のエラーハンドラ（`middleware/ErrorHandler.ts`）が作る
- API テストは `tests/fakes/TestApp.ts` の `build()` を supertest に渡す。DB を使わないテストは `FakeDatabase` で済ませる
- テーブルの追加・変更は dbmate のマイグレーション（`db/migrations/`）で行い、マイグレーションのテストも書く。`db/schema.sql` は dbmate が書き出すので手で編集しない（docs/spec/data.md §1）
- フォルダ構成と層の分け方は docs/spec/architecture.md §3 に従う（層の向きは lint で止まる）
