import type { Event } from "../../../shared/types";
import type { NewEvent } from "../services/EventService";
import { AppError } from "../services/errors";

export interface EventInputParser {
  events(body: unknown): NewEvent[];
}

const TYPES: readonly unknown[] = ["client_error"] satisfies Event["type"][];
const MAX_EVENTS = 50;
const MAX_PAYLOAD_BYTES = 2048;
// ISO 8601 の日時（タイムゾーン付き）。受ける年は 1000〜9999 年（UTC に直したあとで確かめる。DB の timestamptz はもっと広いが、API の範囲は変えない）
const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;
const YEAR_MIN = 1000;
const YEAR_MAX = 9999;

// POST /api/events の入力検証（api.md §2、data.md §3）。違反は 400 VALIDATION_ERROR
export class EventInput implements EventInputParser {
  events(body: unknown): NewEvent[] {
    const { events } = this.#object(body, "本文は JSON のオブジェクト");
    if (!Array.isArray(events) || events.length < 1 || events.length > MAX_EVENTS) {
      throw this.#invalid(`events は 1〜${MAX_EVENTS} 件の配列`);
    }
    return events.map((event: unknown) => this.#event(event));
  }

  #event(value: unknown): NewEvent {
    const { type, payload, occurredAt } = this.#object(value, "イベントはオブジェクト");
    if (!this.#isType(type)) throw this.#invalid("type は screens.md §8 の種類");
    return { type, payload: this.#payload(payload), occurredAt: this.#occurredAt(occurredAt) };
  }

  #payload(value: unknown): Record<string, unknown> {
    const payload = this.#object(value, "payload は JSON のオブジェクト");
    if (Buffer.byteLength(JSON.stringify(payload)) > MAX_PAYLOAD_BYTES) throw this.#invalid(`payload は ${MAX_PAYLOAD_BYTES} バイトまで`);
    return payload;
  }

  #occurredAt(value: unknown): Date {
    const invalid = this.#invalid("occurredAt は ISO 8601 の日時");
    const match = typeof value === "string" ? DATE_TIME.exec(value) : null;
    if (typeof value !== "string" || match === null) throw invalid;
    // 存在しない日（2月30日など）は Date が繰り上げることがあるので、年月日を組み立て直して同じになるかで確かめる
    const [, year, month, day] = match.map(Number);
    const calendar = new Date(Date.UTC(year ?? 0, (month ?? 0) - 1, day ?? 0));
    if (calendar.getUTCMonth() !== (month ?? 0) - 1 || calendar.getUTCDate() !== day) throw invalid;
    const date = new Date(value);
    // 25 時などは Date が読めない。タイムゾーンを引くと年がずれる（9999-12-31T23:00-05:00 は UTC で 10000 年）
    if (Number.isNaN(date.getTime()) || date.getUTCFullYear() < YEAR_MIN || date.getUTCFullYear() > YEAR_MAX) throw invalid;
    return date;
  }

  #object(value: unknown, message: string): Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw this.#invalid(message);
    return { ...value };
  }

  #isType(value: unknown): value is Event["type"] {
    return TYPES.includes(value);
  }

  #invalid(message: string): AppError {
    return new AppError("VALIDATION_ERROR", message);
  }
}
