import type { IRouter } from "express";
import { AppError } from "../services/errors";
import type { SuggestionUseCases } from "../services/SuggestionService";
import type { Controller, JsonResponse } from "./http";
import type { PathIdParser } from "./PathId";

type Params = { id?: string };

// 提案の API（api.md §2）。追加は POST /api/options { title, suggestionId } のまま（OptionsController）
export class SuggestionsController implements Controller {
  readonly #suggestions: SuggestionUseCases;
  readonly #ids: PathIdParser;

  constructor(suggestions: SuggestionUseCases, ids: PathIdParser) {
    this.#suggestions = suggestions;
    this.#ids = ids;
  }

  register(router: IRouter): void {
    router.get("/api/suggestions", (_req, res) => this.catalog(res));
    router.get("/api/suggestions/:id", (req, res) => this.detail(req.params, res));
  }

  async catalog(res: JsonResponse): Promise<void> {
    res.json(await this.#suggestions.catalog());
  }

  async detail(params: Params, res: JsonResponse): Promise<void> {
    res.json(await this.#suggestions.detail(this.#id(params.id)));
  }

  // パスの :id。正の整数でなければ、その提案は存在しないので 404（api.md §3）
  #id(value: unknown): number {
    const id = this.#ids.parse(value);
    if (id === null) throw new AppError("NOT_FOUND", `suggestion ${String(value)} が見つからない`);
    return id;
  }
}
