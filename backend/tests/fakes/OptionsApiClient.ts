import type { Express } from "express";
import request from "supertest";
import type { Test } from "supertest";
import type { Option } from "../../../shared/types";

// 応答のうちテストで見るところ。分割代入して使う（res.body.x と 2 段たどらないように。L4）
// setCookie は最初の Set-Cookie ヘッダー（なければ null）
export type ApiResult = { status: number; body: unknown; text: string; headers: Record<string, unknown>; setCookie: string | null };

type Build = (client: ReturnType<typeof request>) => Test;

export interface SessionClient {
  cookie(): string | null;
  // 次のリクエストから、この Cookie（"ol_session=…"。null でなし）で呼ぶ
  use(cookie: string | null): void;
  send(build: Build): Promise<ApiResult>;
}

export interface OptionsClient {
  list(query: string): Promise<ApiResult>;
  detail(id: number | string): Promise<ApiResult>;
  create(body: object): Promise<ApiResult>;
  patch(id: number | string, body: object): Promise<ApiResult>;
  remove(id: number | string): Promise<ApiResult>;
  reorder(body: object): Promise<ApiResult>;
  achieve(id: number | string): Promise<ApiResult>;
}

// セッションの Cookie を持ち回る（ブラウザと同じ。api.md §6）。最初は cookie（"ol_session=…"）か、なし
// 応答の Set-Cookie で入れ直す。同じ Cookie を別のクライアントに渡すときは cookie() で読む
export class SessionAgent implements SessionClient {
  readonly #app: Express;
  #cookie: string | null;

  constructor(app: Express, cookie: string | null = null) {
    this.#app = app;
    this.#cookie = cookie;
  }

  cookie(): string | null {
    return this.#cookie;
  }

  use(cookie: string | null): void {
    this.#cookie = cookie;
  }

  async send(build: Build): Promise<ApiResult> {
    const test = build(request(this.#app));
    if (this.#cookie !== null) test.set("Cookie", this.#cookie);
    const { status, body, text, headers } = await test;
    const values: unknown = headers["set-cookie"];
    const [first] = Array.isArray(values) ? values : [];
    const setCookie = typeof first === "string" ? first : null;
    if (setCookie !== null) {
      const [pair = ""] = setCookie.split(";");
      this.#cookie = pair;
    }
    return { status, body, text, headers, setCookie };
  }
}

// API テスト用に options の API を supertest で呼ぶ。cookie を渡さなければ、最初の追加でアカウントができる
export class OptionsApiClient implements OptionsClient, SessionClient {
  readonly #agent: SessionAgent;

  constructor(app: Express, cookie: string | null = null) {
    this.#agent = new SessionAgent(app, cookie);
  }

  cookie(): string | null {
    return this.#agent.cookie();
  }

  use(cookie: string | null): void {
    this.#agent.use(cookie);
  }

  // options 以外のルート（写真など）を同じ Cookie で呼ぶ
  send(build: Build): Promise<ApiResult> {
    return this.#agent.send(build);
  }

  // 写真を multipart の photo で PUT する（api.md §5）
  upload(path: string, bytes: Buffer, filename: string): Promise<ApiResult> {
    return this.#agent.send((r) => {
      const pending = r.put(path);
      return pending.attach("photo", bytes, filename);
    });
  }

  list(query: string): Promise<ApiResult> {
    return this.#agent.send((r) => r.get(`/api/options${query}`));
  }

  detail(id: number | string): Promise<ApiResult> {
    return this.#agent.send((r) => r.get(`/api/options/${id}`));
  }

  create(body: object): Promise<ApiResult> {
    return this.#agent.send((r) => r.post("/api/options").send(body));
  }

  patch(id: number | string, body: object): Promise<ApiResult> {
    return this.#agent.send((r) => r.patch(`/api/options/${id}`).send(body));
  }

  remove(id: number | string): Promise<ApiResult> {
    return this.#agent.send((r) => r.delete(`/api/options/${id}`));
  }

  reorder(body: object): Promise<ApiResult> {
    return this.#agent.send((r) => r.put("/api/options/order").send(body));
  }

  achieve(id: number | string): Promise<ApiResult> {
    return this.#agent.send((r) => r.post(`/api/options/${id}/achievements`));
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
}
