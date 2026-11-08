import type { Express } from "express";
import request from "supertest";
import type { SuggestionCatalog, SuggestionDetail } from "../../../shared/types";
import type { ApiResult } from "./OptionsApiClient";

export interface SuggestionsClient {
  catalog(): Promise<SuggestionCatalog>;
  detail(id: number | string): Promise<ApiResult>;
  found(id: number): Promise<SuggestionDetail>;
}

// API テスト用に提案の API を supertest で呼ぶ
export class SuggestionsApiClient implements SuggestionsClient {
  readonly #app: Express;

  constructor(app: Express) {
    this.#app = app;
  }

  // 200 でなければ失敗させる
  async catalog(): Promise<SuggestionCatalog> {
    const { status, body, text } = await request(this.#app).get("/api/suggestions");
    if (status !== 200) throw new Error(`一覧の取得に失敗した（${status}）: ${text}`);
    return body as SuggestionCatalog;
  }

  async detail(id: number | string): Promise<ApiResult> {
    const { status, body, text } = await request(this.#app).get(`/api/suggestions/${id}`);
    return { status, body, text };
  }

  async found(id: number): Promise<SuggestionDetail> {
    const { status, body, text } = await this.detail(id);
    if (status !== 200) throw new Error(`提案 ${id} の取得に失敗した（${status}）: ${text}`);
    return body as SuggestionDetail;
  }
}
