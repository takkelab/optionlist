import type { CookieOptions } from "express";
import type { JsonResponse, TextResponse } from "../../src/controllers/http";
import type { CookieResponse } from "../../src/middleware/SessionCookie";

export type SetCookie = { name: string; value: string; options: CookieOptions };

// controllers の UT 用。Express の Response の代わりに、渡された値を覚えておく
export class FakeResponse implements JsonResponse, TextResponse, CookieResponse {
  #status = 200;
  #contentType: string | null = null;
  #body: unknown = undefined;
  readonly #cookies: SetCookie[] = [];

  status(code: number): FakeResponse {
    this.#status = code;
    return this;
  }

  json(body: unknown): void {
    this.#body = body;
  }

  end(): void {
    this.#body = undefined;
  }

  type(contentType: string): FakeResponse {
    this.#contentType = contentType;
    return this;
  }

  send(body: string): void {
    this.#body = body;
  }

  cookie(name: string, value: string, options: CookieOptions): FakeResponse {
    this.#cookies.push({ name, value, options });
    return this;
  }

  statusCode(): number {
    return this.#status;
  }

  contentType(): string | null {
    return this.#contentType;
  }

  body(): unknown {
    return this.#body;
  }

  // 書いた Set-Cookie（書いた順）
  cookies(): SetCookie[] {
    return [...this.#cookies];
  }
}
