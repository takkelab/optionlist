import type { EventStore, NewEvent } from "../../src/repositories/EventRepository";

type Saved = NewEvent & { receivedAt: Date };

// EventStore のフェイク。入れたイベントを覚えておく
export class FakeEventStore implements EventStore {
  readonly #saved: Saved[] = [];

  async insertMany(events: NewEvent[], receivedAt: Date): Promise<void> {
    this.#saved.push(...events.map((event) => ({ ...event, receivedAt })));
  }

  saved(): Saved[] {
    return [...this.#saved];
  }
}
