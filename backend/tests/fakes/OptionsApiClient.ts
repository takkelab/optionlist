import type { Express } from "express";
import request from "supertest";
import type { Option } from "../../../shared/types";

// 応答のうちテストで見るところ。分割代入して使う（res.body.x と 2 段たどらないように。L4）
export type ApiResult = { status: number; body: unknown; text: string };

export interface OptionsClient {
  list(query: string): Promise<ApiResult>;
  detail(id: number | string): Promise<ApiResult>;
  create(body: object): Promise<ApiResult>;
  patch(id: number | string, body: object): Promise<ApiResult>;
  remove(id: number | string): Promise<ApiResult>;
  reorder(body: object): Promise<ApiResult>;
  achieve(id: number | string): Promise<ApiResult>;
}

// API テスト用に options の API を supertest で呼ぶ
export class OptionsApiClient implements OptionsClient {
  readonly #app: Express;

  constructor(app: Express) {
    this.#app = app;
  }

  list(query: string): Promise<ApiResult> {
    return this.#result(request(this.#app).get(`/api/options${query}`));
  }

  detail(id: number | string): Promise<ApiResult> {
    return this.#result(request(this.#app).get(`/api/options/${id}`));
  }

  create(body: object): Promise<ApiResult> {
    return this.#result(request(this.#app).post("/api/options").send(body));
  }

  patch(id: number | string, body: object): Promise<ApiResult> {
    return this.#result(request(this.#app).patch(`/api/options/${id}`).send(body));
  }

  remove(id: number | string): Promise<ApiResult> {
    return this.#result(request(this.#app).delete(`/api/options/${id}`));
  }

  reorder(body: object): Promise<ApiResult> {
    return this.#result(request(this.#app).put("/api/options/order").send(body));
  }

  achieve(id: number | string): Promise<ApiResult> {
    return this.#result(request(this.#app).post(`/api/options/${id}/achievements`));
  }

  // 追加して、作られた option を返す（201 でなければ失敗させる）
  async added(title: string, suggestionId?: number): Promise<Option> {
    const { status, body, text } = await this.create({ title, suggestionId });
    if (status !== 201) throw new Error(`追加に失敗した（${status}）: ${text}`);
    return body as Option;
  }

  async titles(query: string): Promise<string[]> {
    const { body } = await this.list(query);
    return (body as Option[]).map((o) => o.title);
  }

  async #result(pending: PromiseLike<{ status: number; body: unknown; text: string }>): Promise<ApiResult> {
    const { status, body, text } = await pending;
    return { status, body, text };
  }
}
