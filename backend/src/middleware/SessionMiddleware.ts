import type { RequestHandler } from "express";
// architecture.md §3.1 の例外: Cookie から人を決めるために、services の SessionResolver だけを import type で読む
import type { SessionResolver } from "../services/AccountService";
import type { Middleware } from "./Middleware";
import type { SessionCookieJar } from "./SessionCookie";
import type { CurrentUser } from "./SessionLocals";

// DB に触らないルート（DB が落ちていても /api/health/db が 503 を返せるように、ここでは DB を読まない）
const WITHOUT_SESSION = /^\/api\/(health|metrics)(\/|$)/;

// /api のリクエストごとに、Cookie の鍵から人を決めて res.locals に置く（api.md §6）
// Cookie がない・無効なら「アカウントがない人」（null）。アカウントは作らない（作るのは POST /api/options だけ）
// その日はじめてのリクエストなら Cookie を入れ直して期限を延ばす
export class SessionMiddleware implements Middleware {
  readonly #resolver: SessionResolver;
  readonly #cookie: SessionCookieJar;
  readonly #user: CurrentUser;

  constructor(resolver: SessionResolver, cookie: SessionCookieJar, user: CurrentUser) {
    this.#resolver = resolver;
    this.#cookie = cookie;
    this.#user = user;
  }

  handler(): RequestHandler {
    return async (req, res, next) => {
      const { path } = req;
      if (!path.startsWith("/api/") || WITHOUT_SESSION.test(path)) {
        next();
        return;
      }
      const key = this.#cookie.read(req.get("cookie"));
      const session = await this.#resolver.resolve(key);
      this.#user.set(res, session.userId);
      if (session.refresh && key !== null) this.#cookie.write(res, key);
      next();
    };
  }
}
