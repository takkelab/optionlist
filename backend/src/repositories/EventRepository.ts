import type { Event } from "../../../shared/types";
import type { Database } from "../infra/PgDatabase";

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

  // 列ごとの配列を unnest で行に戻す（件数によらずプレースホルダは 4 つ）
  async insertMany(events: NewEvent[], receivedAt: Date): Promise<void> {
    await this.#db.query(
      `INSERT INTO events (type, payload, occurred_at, received_at)
       SELECT type, payload, occurred_at, $4 FROM unnest($1::text[], $2::jsonb[], $3::timestamptz[]) AS e(type, payload, occurred_at)`,
      [events.map((e) => e.type), events.map((e) => JSON.stringify(e.payload)), events.map((e) => e.occurredAt), receivedAt],
    );
  }
}
