import type { Express } from "express";
import type { SuggestionCatalog, SuggestionDetail } from "../../../shared/types";
import { SessionAgent } from "./OptionsApiClient";
import type { ApiResult } from "./OptionsApiClient";

export interface SuggestionsClient {
  catalog(): Promise<SuggestionCatalog>;
  detail(id: number | string): Promise<ApiResult>;
  found(id: number): Promise<SuggestionDetail>;
}

// API テスト用に提案の API を supertest で呼ぶ。cookie（"ol_session=…"）を渡すとその人として呼ぶ
export class SuggestionsApiClient implements SuggestionsClient {
  readonly #agent: SessionAgent;

  constructor(app: Express, cookie: string | null = null) {
    this.#agent = new SessionAgent(app, cookie);
  }

  // 次のリクエストから、この Cookie で呼ぶ
  use(cookie: string | null): void {
    this.#agent.use(cookie);
  }

  // 200 でなければ失敗させる
  async catalog(): Promise<SuggestionCatalog> {
    const { status, body, text } = await this.#agent.send((r) => r.get("/api/suggestions"));
    if (status !== 200) throw new Error(`一覧の取得に失敗した（${status}）: ${text}`);
    return body as SuggestionCatalog;
  }

  detail(id: number | string): Promise<ApiResult> {
    return this.#agent.send((r) => r.get(`/api/suggestions/${id}`));
  }

  async found(id: number): Promise<SuggestionDetail> {
    const { status, body, text } = await this.detail(id);
    if (status !== 200) throw new Error(`提案 ${id} の取得に失敗した（${status}）: ${text}`);
    return body as SuggestionDetail;
  }
}
