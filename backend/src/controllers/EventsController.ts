import type { IRouter } from "express";
import type { EventUseCases } from "../services/EventService";
import type { EventInputParser } from "./EventInput";
import type { Controller, JsonResponse } from "./http";

// POST /api/events（api.md §2）。保存したら本文なしの 202
export class EventsController implements Controller {
  readonly #input: EventInputParser;
  readonly #events: EventUseCases;

  constructor(input: EventInputParser, events: EventUseCases) {
    this.#input = input;
    this.#events = events;
  }

  register(router: IRouter): void {
    router.post("/api/events", (req, res) => this.create(req.body, res));
  }

  async create(body: unknown, res: JsonResponse): Promise<void> {
    await this.#events.record(this.#input.events(body));
    res.status(202).end();
  }
}
