import type { JsonResponse, TextResponse } from "../../src/controllers/http";

// controllers の UT 用。Express の Response の代わりに、渡された値を覚えておく
export class FakeResponse implements JsonResponse, TextResponse {
  #status = 200;
  #contentType: string | null = null;
  #body: unknown = undefined;

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

  statusCode(): number {
    return this.#status;
  }

  contentType(): string | null {
    return this.#contentType;
  }

  body(): unknown {
    return this.#body;
  }
}
