import type { CookieResponse, SessionCookieJar } from "../middleware/SessionCookie";
import type { CurrentUser } from "../middleware/SessionLocals";
import type { AccountStarter } from "../services/AccountService";
import type { OptionUseCases } from "../services/OptionService";
import type { Controller, JsonResponse, Routes } from "./http";
import type { OptionInputParser } from "./OptionInput";

type Query = Record<string, unknown>;
type Params = { id?: string };
// userId はセッションの middleware が決めたその人（null はアカウントがない人。api.md §1）
type UserId = number | null;

export type OptionsControllerDeps = {
  input: OptionInputParser;
  options: OptionUseCases;
  user: CurrentUser;
  accounts: AccountStarter;
  cookie: SessionCookieJar;
};

// options の API（api.md §2）。入力は OptionInput で検証し、処理は OptionService に任せる
// 想定内のエラーは AppError で投げ、応答は共通のエラーハンドラが作る（Express 5 は async の reject も渡す）
export class OptionsController implements Controller {
  readonly #input: OptionInputParser;
  readonly #options: OptionUseCases;
  readonly #user: CurrentUser;
  readonly #accounts: AccountStarter;
  readonly #cookie: SessionCookieJar;

  constructor(deps: OptionsControllerDeps) {
    this.#input = deps.input;
    this.#options = deps.options;
    this.#user = deps.user;
    this.#accounts = deps.accounts;
    this.#cookie = deps.cookie;
  }

  register(router: Routes): void {
    router.get("/api/options", (req, res) => this.list(this.#user.of(res), req.query, res));
    router.post("/api/options", (req, res) => this.create(this.#user.of(res), req.ip ?? "", req.body, res));
    router.put("/api/options/order", (req, res) => this.reorder(this.#user.of(res), req.body, res));
    router.get("/api/options/:id", (req, res) => this.detail(this.#user.of(res), req.params, res));
    router.patch("/api/options/:id", (req, res) => this.update(this.#user.of(res), req.params, req.body, res));
    router.delete("/api/options/:id", (req, res) => this.remove(this.#user.of(res), req.params, res));
  }

  async list(userId: UserId, query: Query, res: JsonResponse): Promise<void> {
    res.json(await this.#options.list(userId, this.#input.status(query.status)));
  }

  // アカウントがなければ、入力を確かめたあとでここで作り、Cookie を返す（api.md §6）
  async create(userId: UserId, ip: string, body: unknown, res: JsonResponse & CookieResponse): Promise<void> {
    const input = this.#input.newOption(body);
    let owner = userId;
    if (owner === null) {
      const started = await this.#accounts.start(ip);
      this.#cookie.write(res, started.sessionKey);
      owner = started.userId;
    }
    res.status(201).json(await this.#options.create(owner, input));
  }

  async detail(userId: UserId, params: Params, res: JsonResponse): Promise<void> {
    res.json(await this.#options.detail(userId, this.#input.id(params.id)));
  }

  async update(userId: UserId, params: Params, body: unknown, res: JsonResponse): Promise<void> {
    const id = this.#input.id(params.id);
    res.json(await this.#options.update(userId, id, this.#input.patch(body)));
  }

  async remove(userId: UserId, params: Params, res: JsonResponse): Promise<void> {
    await this.#options.remove(userId, this.#input.id(params.id));
    res.status(204).end();
  }

  async reorder(userId: UserId, body: unknown, res: JsonResponse): Promise<void> {
    await this.#options.reorder(userId, this.#input.ids(body));
    res.status(204).end();
  }
}
