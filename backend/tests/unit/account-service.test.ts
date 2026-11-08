import { createHash, createHmac } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { AccountService, RandomSessionKeys } from "../../src/services/AccountService";
import { AppError } from "../../src/services/errors";
import { FakeAccountStore, FixedSessionKeys } from "../fakes/FakeAccountStore";
import { FixedClock } from "../fakes/FakeOptionStore";

// 32 バイトの base64url（43 文字）
const KEY = "a".repeat(43);
const NOW = "2026-11-10T00:00:00.000Z";
const SECRET = "secret";

describe("AccountService", () => {
  let store: FakeAccountStore;
  let clock: FixedClock;
  let service: AccountService;
  const sha256 = (value: string): string => {
    const hash = createHash("sha256");
    hash.update(value);
    return hash.digest("hex");
  };

  beforeEach(() => {
    store = new FakeAccountStore();
    clock = new FixedClock(NOW);
    service = new AccountService(store, store, clock, new FixedSessionKeys([KEY, "b".repeat(43)]), SECRET);
  });

  describe("resolve", () => {
    it.each([null, "", "short", `${KEY}x`, "a".repeat(42) + "!"])("treats the key %s as no account without asking the store", async (key) => {
      store.give(sha256(String(key)), { userId: 9, lastSeenAt: new Date(NOW) });
      expect(await service.resolve(key)).toEqual({ userId: null, refresh: false });
    });

    it("treats an unknown key as no account", async () => {
      expect(await service.resolve(KEY)).toEqual({ userId: null, refresh: false });
    });

    // 「今日」は日本時間の日付（api.md §6）。2026-11-10T00:00Z は日本時間 11/10 9:00
    it("does not write last_seen_at again on the same day in Japan time", async () => {
      store.give(sha256(KEY), { userId: 3, lastSeenAt: new Date("2026-11-09T15:00:00.000Z") });
      expect(await service.resolve(KEY)).toEqual({ userId: 3, refresh: false });
      expect(store.touched()).toEqual([]);
    });

    it("writes last_seen_at and asks to set the cookie again on a new day in Japan time", async () => {
      store.give(sha256(KEY), { userId: 3, lastSeenAt: new Date("2026-11-09T14:59:59.999Z") });
      expect(await service.resolve(KEY)).toEqual({ userId: 3, refresh: true });
      expect(store.touched()).toEqual([{ userId: 3, at: NOW }]);
    });
  });

  describe("start", () => {
    // DB に渡すのは鍵の SHA-256 と、IP の HMAC だけ（data.md §2）
    it("creates an account with the hash of a new key and the HMAC of the IP", async () => {
      expect(await service.start("203.0.113.1")).toEqual({ userId: 1, sessionKey: KEY });
      const hmac = createHmac("sha256", SECRET);
      hmac.update("203.0.113.1");
      expect(store.ipHashes()).toEqual([hmac.digest("hex")]);
      expect(await service.resolve(KEY)).toMatchObject({ userId: 1 });
    });

    it("answers TOO_MANY_REQUESTS with Retry-After when the IP is over the limit", async () => {
      store.rateLimit();
      const error = await service.start("203.0.113.1").catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AppError);
      expect(error instanceof AppError && [error.code(), error.status(), error.retryAfterSeconds()]).toEqual(["TOO_MANY_REQUESTS", 429, 120]);
    });
  });

  it("refuses to start without IP_HASH_SECRET", () => {
    expect(() => new AccountService(store, store, clock, new RandomSessionKeys(), "")).toThrow("IP_HASH_SECRET");
  });

  it("makes random 43-character base64url keys", () => {
    const keys = new RandomSessionKeys();
    const [a, b] = [keys.next(), keys.next()];
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });
});
