import type { CookieResponse, SessionCookieJar } from "../middleware/SessionCookie";
import type { CurrentUser } from "../middleware/SessionLocals";
import type { AccountUseCases } from "../services/AccountSettingsService";
import type { AccountInputParser } from "./AccountInput";
import type { Controller, JsonResponse, Routes } from "./http";

// userId はセッションの middleware が決めたその人（null はアカウントがない人。api.md §1）
type UserId = number | null;

export type AccountControllerDeps = {
  input: AccountInputParser;
  accounts: AccountUseCases;
  user: CurrentUser;
  cookie: SessionCookieJar;
};

// アカウントの API（api.md §2・§6）。どのルートも自分のアカウントだけを扱い、ほかの人の id を取らない
export class AccountController implements Controller {
  readonly #input: AccountInputParser;
  readonly #accounts: AccountUseCases;
  readonly #user: CurrentUser;
  readonly #cookie: SessionCookieJar;

  constructor(deps: AccountControllerDeps) {
    this.#input = deps.input;
    this.#accounts = deps.accounts;
    this.#user = deps.user;
    this.#cookie = deps.cookie;
  }

  register(router: Routes): void {
    router.get("/api/account", (_req, res) => this.status(this.#user.of(res), res));
    router.post("/api/account/recovery-code", (_req, res) => this.issue(this.#user.of(res), res));
    router.post("/api/account/restore", (req, res) => this.restore(this.#user.of(res), req.ip ?? "", req.body, res));
    router.delete("/api/account", (_req, res) => this.remove(this.#user.of(res), res));
  }

  async status(userId: UserId, res: JsonResponse): Promise<void> {
    res.json(await this.#accounts.status(userId));
  }

  async issue(userId: UserId, res: JsonResponse): Promise<void> {
    res.status(201).json(await this.#accounts.issueRecoveryCode(userId));
  }

  // 移った先のアカウントの鍵で Cookie を入れ直す（前の端末の Cookie は鍵が変わるので無効になる）
  async restore(userId: UserId, ip: string, body: unknown, res: JsonResponse & CookieResponse): Promise<void> {
    const input = this.#input.restore(body);
    const moved = await this.#accounts.restore(userId, ip, input);
    this.#cookie.write(res, moved.sessionKey);
    res.json(await this.#accounts.status(moved.userId));
  }

  async remove(userId: UserId, res: JsonResponse & CookieResponse): Promise<void> {
    await this.#accounts.removeAll(userId);
    this.#cookie.clear(res);
    res.status(204).end();
  }
}
