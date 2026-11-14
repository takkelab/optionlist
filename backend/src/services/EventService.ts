import type { EventStore, NewEvent } from "../repositories/EventRepository";
import type { Clock } from "./Clock";

export type { NewEvent };

export interface EventUseCases {
  record(events: NewEvent[]): Promise<void>;
}

// 受け取った件数の出力先（server.ts では JsonLogger を渡す）。メッセージ・画面は出さず、件数だけ（docs/decisions/0042・0062）
export type ReceivedLog = {
  info(entry: { kind: "client_error_received"; message: string; counts: { clientErrors: number } }): void;
};

// 利用イベントの保存（screens.md §8）。受け取った時刻を received_at に入れる
// 保存した client_error の件数をログに出し、Cloud Monitoring が 1 時間の合計でアラートにする（metrics.md §8）
export class EventService implements EventUseCases {
  readonly #store: EventStore;
  readonly #clock: Clock;
  readonly #log: ReceivedLog;

  constructor(store: EventStore, clock: Clock, log: ReceivedLog) {
    this.#store = store;
    this.#clock = clock;
    this.#log = log;
  }

  async record(events: NewEvent[]): Promise<void> {
    await this.#store.insertMany(events, this.#clock.now());
    const clientErrors = events.filter((event) => event.type === "client_error").length;
    if (clientErrors > 0) this.#log.info({ kind: "client_error_received", message: "client_error を受け取った", counts: { clientErrors } });
  }
}
