import type { CurrentUser } from "../middleware/SessionLocals";
import { AppError } from "../services/errors";
import type { SuggestionUseCases } from "../services/SuggestionService";
import type { Controller, JsonResponse, Routes } from "./http";
import type { PathIdParser } from "./PathId";

type Params = { id?: string };

// 提案の API（api.md §2）。追加は POST /api/options { title, suggestionId } のまま（OptionsController）
// アカウントがなくても読める（optionStatus・optionId は全部 null）
export class SuggestionsController implements Controller {
  readonly #suggestions: SuggestionUseCases;
  readonly #ids: PathIdParser;
  readonly #user: CurrentUser;

  constructor(suggestions: SuggestionUseCases, ids: PathIdParser, user: CurrentUser) {
    this.#suggestions = suggestions;
    this.#ids = ids;
    this.#user = user;
  }

  register(router: Routes): void {
    router.get("/api/suggestions", (_req, res) => this.catalog(this.#user.of(res), res));
    router.get("/api/suggestions/:id", (req, res) => this.detail(this.#user.of(res), req.params, res));
  }

  async catalog(userId: number | null, res: JsonResponse): Promise<void> {
    res.json(await this.#suggestions.catalog(userId));
  }

  async detail(userId: number | null, params: Params, res: JsonResponse): Promise<void> {
    res.json(await this.#suggestions.detail(userId, this.#id(params.id)));
  }

  // パスの :id。正の整数でなければ、その提案は存在しないので 404（api.md §3）
  #id(value: unknown): number {
    const id = this.#ids.parse(value);
    if (id === null) throw new AppError("NOT_FOUND", `suggestion ${String(value)} が見つからない`);
    return id;
  }
}
