import type { RequestHandler } from "express";
import { AppError } from "../services/errors";
import type { ApiWriteCheck } from "./ApiGuards";
import type { Middleware } from "./Middleware";
import type { CurrentUser } from "./SessionLocals";

// 数える口（services/RateLimiter の MemoryRateLimiter がこの形を満たす。middleware は services を読まないので形だけ書く）
export interface HitCounter {
  hit(key: string): { allowed: true } | { allowed: false; retryAfterSeconds: number };
}

export type WriteLimiters = { events: HitCounter; writes: HitCounter };

// 復旧コードの入力は DB の auth_attempts で数える（api.md §6）。ここでは数えない
const COUNTED_IN_DB = "/api/account/restore";

// 書き込みの回数の制限（api.md §6。docs/decisions/0038）。超えたら 429 と Retry-After
// - POST /api/events: アカウントなしでも受け取るので、IP で数える
// - そのほかの書き込み: アカウントで数える（アカウントがない人の書き込みは、作成〈DB で数える〉か 404 になるので数えない）
// IP は台のメモリにだけ置き、DB にもログにも出さない
export class WriteRateLimit implements Middleware {
  readonly #limiters: WriteLimiters;
  readonly #requests: ApiWriteCheck;
  readonly #user: CurrentUser;

  constructor(limiters: WriteLimiters, requests: ApiWriteCheck, user: CurrentUser) {
    this.#limiters = limiters;
    this.#requests = requests;
    this.#user = user;
  }

  handler(): RequestHandler {
    return (req, res, next) => {
      const { path, method } = req;
      if (!this.#requests.isWrite(req) || path === COUNTED_IN_DB) {
        next();
        return;
      }
      if (method === "POST" && path === "/api/events") {
        this.#check(this.#limiters.events, `ip:${req.ip ?? ""}`, next);
        return;
      }
      const userId = this.#user.of(res);
      if (userId === null) next();
      else this.#check(this.#limiters.writes, `user:${userId}`, next);
    };
  }

  #check(counter: HitCounter, key: string, next: (error?: unknown) => void): void {
    const decision = counter.hit(key);
    if (decision.allowed) next();
    else next(new AppError("TOO_MANY_REQUESTS", "書き込みの回数が多すぎる。しばらく待ってからやり直す", decision.retryAfterSeconds));
  }
}
