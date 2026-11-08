---
paths:
  - "frontend/**"
---
- backend への通信は `src/api/` のクラス経由にする。コンポーネントから axios を直接呼ばない
- URL は `/api/...` の相対パス（Vite のプロキシで backend に届く）。`http://localhost:8000` を直書きしない
- スマホファースト（幅 375px 前後で崩れないこと）
