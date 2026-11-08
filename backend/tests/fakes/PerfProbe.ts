import type { CountingDatabase } from "./CountingDatabase";

export type TimedResponse = { status: number; body: unknown; ms: number; queries: number };

export interface HttpProbe {
  call(method: string, path: string, body?: unknown): Promise<TimedResponse>;
  // multipart で 1 ファイルを PUT する
  upload(path: string, field: string, bytes: Buffer, filename: string): Promise<TimedResponse>;
}

// 性能テスト用に、listen した backend へ fetch でリクエストし、応答時間とその間に流れた SQL の本数を返す
// リクエストは 1 本ずつ順に送る（SQL の本数をリクエストごとに数えるため）
export class PerfProbe implements HttpProbe {
  readonly #baseUrl: string;
  readonly #db: CountingDatabase;

  constructor(baseUrl: string, db: CountingDatabase) {
    this.#baseUrl = baseUrl;
    this.#db = db;
  }

  call(method: string, path: string, body?: unknown): Promise<TimedResponse> {
    return this.#send(method, path, {
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  upload(path: string, field: string, bytes: Buffer, filename: string): Promise<TimedResponse> {
    const form = new FormData();
    form.append(field, new Blob([new Uint8Array(bytes)]), filename);
    return this.#send("PUT", path, { body: form });
  }

  async #send(method: string, path: string, init: RequestInit): Promise<TimedResponse> {
    const before = this.#db.count();
    const started = performance.now();
    const res = await fetch(`${this.#baseUrl}${path}`, { ...init, method });
    const text = await res.text();
    const ms = performance.now() - started;
    const { status } = res;
    if (status >= 400) throw new Error(`${method} ${path} が ${status} で失敗した: ${text}`);
    return { status, body: text === "" ? null : JSON.parse(text), ms, queries: this.#db.count() - before };
  }
}

export interface Percentile {
  p95(values: number[]): number;
}

// 最近傍法の p95（小数第 1 位まで）
export class NearestRankPercentile implements Percentile {
  p95(values: number[]): number {
    if (values.length === 0) throw new Error("値が 0 件では p95 を出せない");
    const sorted = values.toSorted((a, b) => a - b);
    const value = sorted[Math.ceil(sorted.length * 0.95) - 1] ?? Number.NaN;
    return Math.round(value * 10) / 10;
  }
}
