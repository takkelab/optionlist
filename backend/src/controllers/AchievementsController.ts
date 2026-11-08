import type { CurrentUser } from "../middleware/SessionLocals";
import type { AchievementUseCases } from "../services/AchievementService";
import type { Controller, JsonResponse, Routes } from "./http";
import type { OptionInputParser } from "./OptionInput";

type Params = { id?: string };

// POST /api/options/:id/achievements（api.md §2）。:id の検証は options の API と同じ
export class AchievementsController implements Controller {
  readonly #input: OptionInputParser;
  readonly #achievements: AchievementUseCases;
  readonly #user: CurrentUser;

  constructor(input: OptionInputParser, achievements: AchievementUseCases, user: CurrentUser) {
    this.#input = input;
    this.#achievements = achievements;
    this.#user = user;
  }

  register(router: Routes): void {
    router.post("/api/options/:id/achievements", (req, res) => this.create(this.#user.of(res), req.params, res));
  }

  // userId はセッションの middleware が決めたその人（null はアカウントがない人で、404）
  async create(userId: number | null, params: Params, res: JsonResponse): Promise<void> {
    res.status(201).json(await this.#achievements.record(userId, this.#input.id(params.id)));
  }
}
