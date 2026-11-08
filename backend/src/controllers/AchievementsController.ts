import type { IRouter } from "express";
import type { AchievementUseCases } from "../services/AchievementService";
import type { Controller, JsonResponse } from "./http";
import type { OptionInputParser } from "./OptionInput";

type Params = { id?: string };

// POST /api/options/:id/achievements（api.md §2）。:id の検証は options の API と同じ
export class AchievementsController implements Controller {
  readonly #input: OptionInputParser;
  readonly #achievements: AchievementUseCases;

  constructor(input: OptionInputParser, achievements: AchievementUseCases) {
    this.#input = input;
    this.#achievements = achievements;
  }

  register(router: IRouter): void {
    router.post("/api/options/:id/achievements", (req, res) => this.create(req.params, res));
  }

  async create(params: Params, res: JsonResponse): Promise<void> {
    res.status(201).json(await this.#achievements.record(this.#input.id(params.id)));
  }
}
