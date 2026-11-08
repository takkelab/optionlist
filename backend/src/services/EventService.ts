import type { EventStore, NewEvent } from "../repositories/EventRepository";
import type { Clock } from "./Clock";

export type { NewEvent };

export interface EventUseCases {
  record(events: NewEvent[]): Promise<void>;
}

// 利用イベントの保存（screens.md §8）。受け取った時刻を received_at に入れる
export class EventService implements EventUseCases {
  readonly #store: EventStore;
  readonly #clock: Clock;

  constructor(store: EventStore, clock: Clock) {
    this.#store = store;
    this.#clock = clock;
  }

  record(events: NewEvent[]): Promise<void> {
    return this.#store.insertMany(events, this.#clock.now());
  }
}
