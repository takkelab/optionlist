import type { Event } from "../../../shared/types";
import type { Database } from "../infra/MySqlDatabase";

// 検証を通ったイベント。occurredAt は frontend で起きた時刻
export type NewEvent = { type: Event["type"]; payload: Record<string, unknown>; occurredAt: Date };

export interface EventStore {
  insertMany(events: NewEvent[], receivedAt: Date): Promise<void>;
}

// events テーブルの SQL。1 リクエストの分をまとめて 1 本で入れる
export class EventRepository implements EventStore {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  async insertMany(events: NewEvent[], receivedAt: Date): Promise<void> {
    const rows = events.map((event) => [event.type, JSON.stringify(event.payload), event.occurredAt, receivedAt]);
    await this.#db.query("INSERT INTO events (type, payload, occurred_at, received_at) VALUES ?", [rows]);
  }
}
