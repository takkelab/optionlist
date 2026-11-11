# 本番用のイメージ（architecture.md §4。docs/decisions/0035・0054）
# frontend をビルドし、backend（Express）が API と一緒に frontend/dist も配る。確認用と本番は同じイメージを出す
# 環境ごとの値（APP_ENV・APP_ORIGIN・秘密の値など）はイメージに入れず、Cloud Run が渡す（architecture.md §4.2）

# 1. frontend のビルド（shared/ の型を読む）
FROM node:24-trixie-slim AS frontend
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json frontend/
RUN npm --prefix frontend ci
COPY shared shared
COPY frontend frontend
RUN npm --prefix frontend run build

# 2. backend の依存（本番の分だけ。TypeScript は tsx で実行する。docs/decisions/0054）
FROM node:24-trixie-slim AS backend-deps
WORKDIR /app
COPY backend/package.json backend/package-lock.json backend/
RUN npm --prefix backend ci --omit=dev

# 3. 実行
FROM node:24-trixie-slim
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    FRONTEND_DIST=/app/frontend/dist
# マイグレーションの Cloud Run Job（optionlist-<env>-migrate）も同じイメージで動かす（docs/decisions/0057）
# コマンド: dbmate --no-dump-schema --migrations-dir db/migrations migrate（migrate は DB を作らない。DATABASE_URL は Secret Manager から）
# 版は backend/package-lock.json の dbmate と同じにする
COPY --from=ghcr.io/amacneil/dbmate:2.37.0 /usr/local/bin/dbmate /usr/local/bin/dbmate
# 週 1 の書き出しの Cloud Run Job（optionlist-production-backup。data.md §6）が使う pg_dump。DB と同じ 17 にする（古い版は新しいサーバーを書き出せない）
RUN apt-get update \
 && apt-get install -y --no-install-recommends postgresql-client-17 \
 && rm -rf /var/lib/apt/lists/*
COPY --from=backend-deps /app/backend/node_modules backend/node_modules
COPY backend/package.json backend/tsconfig.json backend/
COPY backend/db/migrations backend/db/migrations
COPY backend/src backend/src
COPY shared shared
COPY --from=frontend /app/frontend/dist frontend/dist
USER node
# --import tsx は今のフォルダから探すので、backend で起動する
WORKDIR /app/backend
EXPOSE 8080
CMD ["node", "--import", "tsx", "--max-semi-space-size=4", "src/server.ts"]
