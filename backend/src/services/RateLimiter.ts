import type { Clock } from "./Clock";

// 1 回数えた結果。超えていれば、窓が終わるまでの秒（Retry-After）
export type RateDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number };

// 台ごとのメモリで数える回数の制限（api.md §6。docs/decisions/0038）
export interface RateLimiter {
  hit(key: string): RateDecision;
}

export type RateLimit = { limit: number; windowMs: number };

type Window = { startedAt: number; count: number };

// 窓が過ぎた鍵を掃除する間隔（数えた回数）。鍵が増え続けてメモリを使い切らないようにする
const SWEEP_EVERY = 1_000;

// 固定の窓で数える。窓の始まりは、その鍵を最初に数えた時刻
export class MemoryRateLimiter implements RateLimiter {
  readonly #limit: RateLimit;
  readonly #clock: Clock;
  readonly #windows = new Map<string, Window>();
  #hits = 0;

  constructor(limit: RateLimit, clock: Clock) {
    this.#limit = limit;
    this.#clock = clock;
  }

  hit(key: string): RateDecision {
    const date = this.#clock.now();
    const now = date.getTime();
    this.#sweepSometimes(now);
    const current = this.#windows.get(key);
    if (current === undefined || this.#expired(current, now)) {
      this.#windows.set(key, { startedAt: now, count: 1 });
      return { allowed: true };
    }
    if (current.count >= this.#limit.limit) {
      const remainingMs = current.startedAt + this.#limit.windowMs - now;
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(remainingMs / 1000)) };
    }
    current.count += 1;
    return { allowed: true };
  }

  // 覚えている鍵の数（掃除のテストに使う）
  size(): number {
    return this.#windows.size;
  }

  #sweepSometimes(now: number): void {
    this.#hits += 1;
    if (this.#hits < SWEEP_EVERY) return;
    this.#hits = 0;
    for (const [key, window] of this.#windows) {
      if (this.#expired(window, now)) this.#windows.delete(key);
    }
  }

  #expired(window: Window, now: number): boolean {
    return now - window.startedAt >= this.#limit.windowMs;
  }
}
