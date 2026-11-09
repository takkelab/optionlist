import type { Express } from "express";
import type { Server } from "node:http";
import request from "supertest";
import type { Test } from "supertest";

// TestApp の自分のオリジン（APP_ORIGIN）。書き込みのテストは Origin にこれを付ける（Origin の確認。api.md §1）
export const TEST_ORIGIN = "http://test.local";

// TestApp の METRICS_TOKEN と、/api/metrics を読むときの Authorization
export const TEST_METRICS_TOKEN = "test-metrics-token";
export const TEST_METRICS_AUTH = `Bearer ${TEST_METRICS_TOKEN}`;

type Method = "get" | "post" | "put" | "patch" | "delete";
type WriteMethod = Exclude<Method, "get">;
type Headers = Record<string, string>;

export interface TestRequestBuilder {
  // トークン付きの GET /api/metrics
  metrics(): Test;
  // 自分のオリジンを Origin に付けた書き込み。headers で足す・上書きする
  write(method: WriteMethod, path: string, headers?: Headers): Test;
  // headers だけを付けた呼び出し（Origin なし・別のオリジンを試す）
  call(method: Method, path: string, headers?: Headers): Test;
}

// Cookie を持ち回らない 1 回だけの呼び出し（Cookie を使うテストは OptionsApiClient の SessionAgent）
export class TestRequests implements TestRequestBuilder {
  readonly #app: Express | Server;

  constructor(app: Express | Server) {
    this.#app = app;
  }

  metrics(): Test {
    return this.call("get", "/api/metrics", { Authorization: TEST_METRICS_AUTH });
  }

  write(method: WriteMethod, path: string, headers: Headers = {}): Test {
    return this.call(method, path, { Origin: TEST_ORIGIN, ...headers });
  }

  call(method: Method, path: string, headers: Headers = {}): Test {
    const client = request(this.#app);
    const test = client[method](path);
    return test.set(headers);
  }
}
