import { beforeEach, describe, expect, it } from "vitest";
import { OptionInput } from "../../src/controllers/OptionInput";
import { OptionsController } from "../../src/controllers/OptionsController";
import { PathId } from "../../src/controllers/PathId";
import { PromMetrics } from "../../src/metrics/PromMetrics";
import { SessionCookie } from "../../src/middleware/SessionCookie";
import { SessionLocals } from "../../src/middleware/SessionLocals";
import { OptionService } from "../../src/services/OptionService";
import { PhotoCleanup } from "../../src/services/PhotoCleanup";
import { GapSortOrderPlanner } from "../../src/services/SortOrderPlanner";
import { FakeAccounts } from "../fakes/FakeAccounts";
import { FakeLogger } from "../fakes/FakeLogger";
import { FakeOptionStore, FixedClock } from "../fakes/FakeOptionStore";
import { FakePhotoFiles } from "../fakes/FakePhotoFiles";
import { FakeResponse } from "../fakes/FakeResponse";

const USER = 7;
const IP = "203.0.113.1";

describe("OptionsController", () => {
  let controller: OptionsController;
  let accounts: FakeAccounts;
  let store: FakeOptionStore;

  beforeEach(() => {
    const cleanup = new PhotoCleanup(new FakePhotoFiles(), new PromMetrics(), new FakeLogger());
    store = new FakeOptionStore();
    const options = new OptionService(store, new FixedClock("2026-11-01T00:00:00.000Z"), new GapSortOrderPlanner(), cleanup);
    accounts = new FakeAccounts();
    const input = new OptionInput(new PathId());
    controller = new OptionsController({ input, options, user: new SessionLocals(), accounts, cookie: new SessionCookie(false) });
  });

  it("answers 201 with the created option and lists it", async () => {
    const created = new FakeResponse();
    await controller.create(USER, IP, { title: "a" }, created);
    expect(created.statusCode()).toBe(201);
    expect(created.body()).toMatchObject({ id: 1, title: "a", status: "pending" });

    const listed = new FakeResponse();
    await controller.list(USER, { status: "pending" }, listed);
    expect(listed.statusCode()).toBe(200);
    expect(listed.body()).toEqual([created.body()]);
  });

  // アカウントがなければ POST /api/options で作り、Cookie を返す（api.md §6）
  it("starts an account and sets the cookie when the person has none", async () => {
    const created = new FakeResponse();
    await controller.create(null, IP, { title: "a" }, created);
    expect(created.statusCode()).toBe(201);
    expect(accounts.startedFrom()).toEqual([IP]);
    expect(store.users()).toEqual([1]);
    expect(created.cookies()).toEqual([
      { name: "ol_session", value: "key-1", options: expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/" }) },
    ]);
  });

  it("does not start another account for a person who has one", async () => {
    const created = new FakeResponse();
    await controller.create(USER, IP, { title: "a" }, created);
    expect(accounts.startedFrom()).toEqual([]);
    expect(created.cookies()).toEqual([]);
  });

  // 入力が違えば、アカウントを作らない
  it("checks the input before starting an account", async () => {
    await expect(controller.create(null, IP, { title: " " }, new FakeResponse())).rejects.toThrow("title は");
    expect(accounts.startedFrom()).toEqual([]);
  });

  it("passes the 429 of the account limit through without adding the option", async () => {
    accounts.rateLimit();
    await expect(controller.create(null, IP, { title: "a" }, new FakeResponse())).rejects.toMatchObject({ message: "多すぎる" });
    expect(store.users()).toEqual([]);
  });

  it("answers the detail and the updated option", async () => {
    await controller.create(USER, IP, { title: "a" }, new FakeResponse());
    const detail = new FakeResponse();
    await controller.detail(USER, { id: "1" }, detail);
    expect(detail.body()).toMatchObject({ id: 1, achievements: [] });

    const updated = new FakeResponse();
    await controller.update(USER, { id: "1" }, { status: "completed" }, updated);
    expect(updated.statusCode()).toBe(200);
    expect(updated.body()).toMatchObject({ id: 1, status: "completed" });
  });

  it("answers 204 without a body for delete and reorder", async () => {
    await controller.create(USER, IP, { title: "a" }, new FakeResponse());
    await controller.create(USER, IP, { title: "b" }, new FakeResponse());

    const reordered = new FakeResponse();
    await controller.reorder(USER, { ids: [1, 2] }, reordered);
    expect(reordered.statusCode()).toBe(204);
    expect(reordered.body()).toBeUndefined();

    const removed = new FakeResponse();
    await controller.remove(USER, { id: "1" }, removed);
    expect(removed.statusCode()).toBe(204);
    expect(removed.body()).toBeUndefined();
  });

  it("rejects invalid input before calling the service", async () => {
    await expect(controller.list(USER, {}, new FakeResponse())).rejects.toThrow("status は");
    await expect(controller.detail(USER, { id: "x" }, new FakeResponse())).rejects.toThrow("が見つからない");
  });
});
