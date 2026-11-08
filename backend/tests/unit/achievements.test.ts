import { beforeEach, describe, expect, it } from "vitest";
import { AchievementsController } from "../../src/controllers/AchievementsController";
import { OptionInput } from "../../src/controllers/OptionInput";
import { PathId } from "../../src/controllers/PathId";
import { AchievementService } from "../../src/services/AchievementService";
import { FakeAchievementStore } from "../fakes/FakeAchievementStore";
import { FixedClock } from "../fakes/FakeOptionStore";
import { FakeResponse } from "../fakes/FakeResponse";

const T0 = "2026-11-03T01:00:00.000Z";

describe("AchievementService and AchievementsController", () => {
  let store: FakeAchievementStore;
  let clock: FixedClock;
  let controller: AchievementsController;

  beforeEach(() => {
    store = new FakeAchievementStore([1]);
    clock = new FixedClock(T0);
    controller = new AchievementsController(new OptionInput(new PathId()), new AchievementService(store, clock));
  });

  it("records an achievement at the current time and answers 201", async () => {
    const res = new FakeResponse();
    await controller.create({ id: "1" }, res);
    expect(res.statusCode()).toBe(201);
    expect(res.body()).toEqual({ id: 1, optionId: 1, achievedAt: T0, photoUrl: null });
  });

  it("records each press as a separate achievement", async () => {
    await controller.create({ id: "1" }, new FakeResponse());
    clock.advance(1_000);
    await controller.create({ id: "1" }, new FakeResponse());
    expect(store.saved().map((a) => a.achievedAt)).toEqual([T0, "2026-11-03T01:00:01.000Z"]);
  });

  it.each(["0", "abc", "2"])("throws NOT_FOUND for the option %s", async (id) => {
    await expect(controller.create({ id }, new FakeResponse())).rejects.toThrow("が見つからない");
    expect(store.saved()).toEqual([]);
  });
});
