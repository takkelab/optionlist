import type { Achievement } from "../../../shared/types";
import type { AchievementStore } from "../repositories/AchievementRepository";
import type { Clock } from "./Clock";

export interface AchievementUseCases {
  record(optionId: number): Promise<Achievement>;
}

// 🎉 を押したときの達成記録（screens.md §4）。やりたい・やったのどちらの項目にも付けられる
export class AchievementService implements AchievementUseCases {
  readonly #store: AchievementStore;
  readonly #clock: Clock;

  constructor(store: AchievementStore, clock: Clock) {
    this.#store = store;
    this.#clock = clock;
  }

  record(optionId: number): Promise<Achievement> {
    return this.#store.insert(optionId, this.#clock.now());
  }
}
