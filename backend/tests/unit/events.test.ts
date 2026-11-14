import { beforeEach, describe, expect, it } from "vitest";
import { EventInput } from "../../src/controllers/EventInput";
import { EventsController } from "../../src/controllers/EventsController";
import { EventService } from "../../src/services/EventService";
import { AppError } from "../../src/services/errors";
import { FakeEventStore } from "../fakes/FakeEventStore";
import { FakeLogger } from "../fakes/FakeLogger";
import { FixedClock } from "../fakes/FakeOptionStore";
import { FakeResponse } from "../fakes/FakeResponse";

const T0 = "2026-11-08T01:00:00.000Z";
const ERROR = { type: "client_error", payload: { message: "boom", route: "/" }, occurredAt: "2026-11-08T00:59:00.000Z" };

// POST /api/events の入力検証と保存（api.md §2、data.md §3）
describe("EventsController and EventInput", () => {
  let store: FakeEventStore;
  let controller: EventsController;
  let logger: FakeLogger;

  beforeEach(() => {
    store = new FakeEventStore();
    logger = new FakeLogger();
    controller = new EventsController(new EventInput(), new EventService(store, new FixedClock(T0), logger));
  });

  it("saves the events with the time they arrived and answers 202 without a body", async () => {
    const res = new FakeResponse();
    await controller.create({ events: [ERROR, { ...ERROR, occurredAt: "2026-11-08T09:59:00+09:00" }] }, res);
    expect(res.statusCode()).toBe(202);
    expect(res.body()).toBeUndefined();
    expect(store.saved()).toEqual([
      { type: "client_error", payload: { message: "boom", route: "/" }, occurredAt: new Date("2026-11-08T00:59:00.000Z"), receivedAt: new Date(T0) },
      { type: "client_error", payload: { message: "boom", route: "/" }, occurredAt: new Date("2026-11-08T00:59:00.000Z"), receivedAt: new Date(T0) },
    ]);
  });

  // Cloud Monitoring が 1 時間の合計でアラートにする（metrics.md §8）。件数だけを出し、メッセージ・画面は出さない
  it("logs only the number of client_error events it saved", async () => {
    await controller.create({ events: [ERROR, ERROR, ERROR] }, new FakeResponse());
    expect(logger.infos()).toEqual([{ kind: "client_error_received", message: "client_error を受け取った", counts: { clientErrors: 3 } }]);
    expect(JSON.stringify(logger.infos())).not.toContain("boom");
  });

  it("logs nothing when the events are rejected", async () => {
    await expect(controller.create({ events: [] }, new FakeResponse())).rejects.toBeInstanceOf(AppError);
    expect(logger.infos()).toEqual([]);
  });

  it("accepts 50 events and a payload of exactly 2048 bytes", async () => {
    // {"m":"..."} の 8 バイトを除いた分を埋める
    const payload = { m: "a".repeat(2048 - 8) };
    await controller.create({ events: [{ ...ERROR, payload }, ...Array.from({ length: 49 }, () => ERROR)] }, new FakeResponse());
    expect(store.saved()).toHaveLength(50);
  });

  it("accepts the first and last moments of the years the API accepts (1000-9999)", async () => {
    const events = ["1000-01-01T00:00:00Z", "9999-12-31T23:59:59.999Z"].map((occurredAt) => ({ ...ERROR, occurredAt }));
    await controller.create({ events }, new FakeResponse());
    expect(store.saved()).toHaveLength(2);
  });

  it.each([
    ["a body that is not an object", []],
    ["no events", {}],
    ["events that is not an array", { events: "x" }],
    ["an empty list", { events: [] }],
    ["51 events", { events: Array.from({ length: 51 }, () => ERROR) }],
    ["an event that is not an object", { events: [null] }],
    ["an unknown type", { events: [{ ...ERROR, type: "screen_view" }] }],
    ["a payload that is an array", { events: [{ ...ERROR, payload: [] }] }],
    ["a missing payload", { events: [{ ...ERROR, payload: undefined }] }],
    ["a payload over 2048 bytes", { events: [{ ...ERROR, payload: { m: "a".repeat(2048 - 7) } }] }],
    ["a payload over 2048 bytes in multibyte characters", { events: [{ ...ERROR, payload: { m: "あ".repeat(700) } }] }],
    ["occurredAt that is not a string", { events: [{ ...ERROR, occurredAt: 1 }] }],
    ["occurredAt without a time zone", { events: [{ ...ERROR, occurredAt: "2026-11-08T00:59:00" }] }],
    ["occurredAt that is a date only", { events: [{ ...ERROR, occurredAt: "2026-11-08" }] }],
    ["occurredAt that does not exist", { events: [{ ...ERROR, occurredAt: "2026-02-30T00:00:00Z" }] }],
    ["occurredAt before the year 1000", { events: [{ ...ERROR, occurredAt: "0999-12-31T00:00:00Z" }] }],
    ["occurredAt at an hour that does not exist", { events: [{ ...ERROR, occurredAt: "2026-11-08T25:00:00Z" }] }],
    ["occurredAt that is the year 10000 in UTC", { events: [{ ...ERROR, occurredAt: "9999-12-31T23:00:00-05:00" }] }],
    ["occurredAt that is the year 999 in UTC", { events: [{ ...ERROR, occurredAt: "1000-01-01T00:00:00+09:00" }] }],
  ])("rejects %s with VALIDATION_ERROR and saves nothing", async (_, body) => {
    const failure = await controller.create(body, new FakeResponse()).then(
      () => null,
      (e: unknown) => e,
    );
    expect(failure).toBeInstanceOf(AppError);
    expect(failure instanceof AppError ? failure.code() : null).toBe("VALIDATION_ERROR");
    expect(store.saved()).toEqual([]);
  });
});
