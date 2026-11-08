import type { RequestHandler } from "express";
import type { Routes } from "../../src/controllers/http";

// 登録されたルートを「GET /api/options/:id」の形で集める（分離テスト。testing.md §7 の 3）。ハンドラは呼ばない
export class RouteRecorder implements Routes {
  readonly #routes: string[] = [];

  get(path: string, ..._handlers: RequestHandler[]): this {
    return this.#add("GET", path);
  }

  post(path: string, ..._handlers: RequestHandler[]): this {
    return this.#add("POST", path);
  }

  put(path: string, ..._handlers: RequestHandler[]): this {
    return this.#add("PUT", path);
  }

  patch(path: string, ..._handlers: RequestHandler[]): this {
    return this.#add("PATCH", path);
  }

  delete(path: string, ..._handlers: RequestHandler[]): this {
    return this.#add("DELETE", path);
  }

  routes(): string[] {
    return [...this.#routes];
  }

  #add(method: string, path: string): this {
    this.#routes.push(`${method} ${path}`);
    return this;
  }
}
