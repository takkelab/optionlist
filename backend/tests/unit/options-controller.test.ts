import { beforeEach, describe, expect, it } from "vitest";
import { OptionInput } from "../../src/controllers/OptionInput";
import { OptionsController } from "../../src/controllers/OptionsController";
import { PathId } from "../../src/controllers/PathId";
import { PromMetrics } from "../../src/metrics/PromMetrics";
import { OptionService } from "../../src/services/OptionService";
import { PhotoCleanup } from "../../src/services/PhotoCleanup";
import { GapSortOrderPlanner } from "../../src/services/SortOrderPlanner";
import { FakeLogger } from "../fakes/FakeLogger";
import { FakeOptionStore, FixedClock } from "../fakes/FakeOptionStore";
import { FakePhotoFiles } from "../fakes/FakePhotoFiles";
import { FakeResponse } from "../fakes/FakeResponse";

describe("OptionsController", () => {
  let controller: OptionsController;

  beforeEach(() => {
    const cleanup = new PhotoCleanup(new FakePhotoFiles(), new PromMetrics(), new FakeLogger());
    const service = new OptionService(new FakeOptionStore(), new FixedClock("2026-11-01T00:00:00.000Z"), new GapSortOrderPlanner(), cleanup);
    controller = new OptionsController(new OptionInput(new PathId()), service);
  });

  it("answers 201 with the created option and lists it", async () => {
    const created = new FakeResponse();
    await controller.create({ title: "a" }, created);
    expect(created.statusCode()).toBe(201);
    expect(created.body()).toMatchObject({ id: 1, title: "a", status: "pending" });

    const listed = new FakeResponse();
    await controller.list({ status: "pending" }, listed);
    expect(listed.statusCode()).toBe(200);
    expect(listed.body()).toEqual([created.body()]);
  });

  it("answers the detail and the updated option", async () => {
    await controller.create({ title: "a" }, new FakeResponse());
    const detail = new FakeResponse();
    await controller.detail({ id: "1" }, detail);
    expect(detail.body()).toMatchObject({ id: 1, achievements: [] });

    const updated = new FakeResponse();
    await controller.update({ id: "1" }, { status: "completed" }, updated);
    expect(updated.statusCode()).toBe(200);
    expect(updated.body()).toMatchObject({ id: 1, status: "completed" });
  });

  it("answers 204 without a body for delete and reorder", async () => {
    await controller.create({ title: "a" }, new FakeResponse());
    await controller.create({ title: "b" }, new FakeResponse());

    const reordered = new FakeResponse();
    await controller.reorder({ ids: [1, 2] }, reordered);
    expect(reordered.statusCode()).toBe(204);
    expect(reordered.body()).toBeUndefined();

    const removed = new FakeResponse();
    await controller.remove({ id: "1" }, removed);
    expect(removed.statusCode()).toBe(204);
    expect(removed.body()).toBeUndefined();
  });

  it("rejects invalid input before calling the service", async () => {
    await expect(controller.list({}, new FakeResponse())).rejects.toThrow("status は");
    await expect(controller.detail({ id: "x" }, new FakeResponse())).rejects.toThrow("が見つからない");
  });
});
