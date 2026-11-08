import type { Achievement } from "../../../shared/types";
import type { AchievementStores } from "../repositories/AchievementRepository";
import type { Clock } from "./Clock";

export interface AchievementUseCases {
  // アカウントがない人・他人の option は 404
  record(userId: number | null, optionId: number): Promise<Achievement>;
}

// 🎉 を押したときの達成記録（screens.md §4）。やりたい・やったのどちらの項目にも付けられる
export class AchievementService implements AchievementUseCases {
  readonly #stores: AchievementStores;
  readonly #clock: Clock;

  constructor(stores: AchievementStores, clock: Clock) {
    this.#stores = stores;
    this.#clock = clock;
  }

  record(userId: number | null, optionId: number): Promise<Achievement> {
    return this.#stores.withUser(userId, (store) => store.insert(optionId, this.#clock.now()));
  }
}
