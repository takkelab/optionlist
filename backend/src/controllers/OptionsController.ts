import type { IRouter } from "express";
import type { OptionUseCases } from "../services/OptionService";
import type { Controller, JsonResponse } from "./http";
import type { OptionInputParser } from "./OptionInput";

type Query = Record<string, unknown>;
type Params = { id?: string };

// options の API（api.md §2）。入力は OptionInput で検証し、処理は OptionService に任せる
// 想定内のエラーは AppError で投げ、応答は共通のエラーハンドラが作る（Express 5 は async の reject も渡す）
export class OptionsController implements Controller {
  readonly #input: OptionInputParser;
  readonly #options: OptionUseCases;

  constructor(input: OptionInputParser, options: OptionUseCases) {
    this.#input = input;
    this.#options = options;
  }

  register(router: IRouter): void {
    router.get("/api/options", (req, res) => this.list(req.query, res));
    router.post("/api/options", (req, res) => this.create(req.body, res));
    router.put("/api/options/order", (req, res) => this.reorder(req.body, res));
    router.get("/api/options/:id", (req, res) => this.detail(req.params, res));
    router.patch("/api/options/:id", (req, res) => this.update(req.params, req.body, res));
    router.delete("/api/options/:id", (req, res) => this.remove(req.params, res));
  }

  async list(query: Query, res: JsonResponse): Promise<void> {
    res.json(await this.#options.list(this.#input.status(query.status)));
  }

  async create(body: unknown, res: JsonResponse): Promise<void> {
    res.status(201).json(await this.#options.create(this.#input.newOption(body)));
  }

  async detail(params: Params, res: JsonResponse): Promise<void> {
    res.json(await this.#options.detail(this.#input.id(params.id)));
  }

  async update(params: Params, body: unknown, res: JsonResponse): Promise<void> {
    const id = this.#input.id(params.id);
    res.json(await this.#options.update(id, this.#input.patch(body)));
  }

  async remove(params: Params, res: JsonResponse): Promise<void> {
    await this.#options.remove(this.#input.id(params.id));
    res.status(204).end();
  }

  async reorder(body: unknown, res: JsonResponse): Promise<void> {
    await this.#options.reorder(this.#input.ids(body));
    res.status(204).end();
  }
}
