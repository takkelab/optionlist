import { describe, expect, it } from "vitest";
import { MemoryRateLimiter } from "../../src/services/RateLimiter";
import { FixedClock } from "../fakes/FakeOptionStore";

// 台ごとのメモリで数える回数の制限（api.md §6）
const NOW = "2026-11-09T03:00:00.000Z";
const LIMIT = { limit: 3, windowMs: 60_000 };
const ALLOWED = { allowed: true };

describe("MemoryRateLimiter", () => {
  it("allows up to the limit in a window and answers the seconds until the window ends", () => {
    const clock = new FixedClock(NOW);
    const limiter = new MemoryRateLimiter(LIMIT, clock);
    expect([limiter.hit("a"), limiter.hit("a"), limiter.hit("a")]).toEqual([ALLOWED, ALLOWED, ALLOWED]);
    clock.advance(20_500);
    expect(limiter.hit("a")).toEqual({ allowed: false, retryAfterSeconds: 40 });
    clock.advance(39_000);
    expect(limiter.hit("a")).toEqual({ allowed: false, retryAfterSeconds: 1 });
  });

  it("starts a new window once the window has passed", () => {
    const clock = new FixedClock(NOW);
    const limiter = new MemoryRateLimiter(LIMIT, clock);
    for (let i = 0; i < 4; i++) limiter.hit("a");
    clock.advance(60_000);
    expect(limiter.hit("a")).toEqual(ALLOWED);
  });

  it("counts each key separately", () => {
    const limiter = new MemoryRateLimiter({ limit: 1, windowMs: 60_000 }, new FixedClock(NOW));
    const results = [limiter.hit("a"), limiter.hit("b"), limiter.hit("a")];
    expect(results).toEqual([ALLOWED, ALLOWED, { allowed: false, retryAfterSeconds: 60 }]);
  });

  it("forgets keys whose window has passed so that memory does not grow", () => {
    const clock = new FixedClock(NOW);
    const limiter = new MemoryRateLimiter(LIMIT, clock);
    for (let i = 0; i < 500; i++) limiter.hit(`old-${i}`);
    clock.advance(60_000);
    for (let i = 0; i < 500; i++) limiter.hit(`new-${i}`);
    expect(limiter.size()).toBe(500);
  });
});
