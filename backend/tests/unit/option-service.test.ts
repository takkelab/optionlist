import { beforeEach, describe, expect, it } from "vitest";
import { PromMetrics } from "../../src/metrics/PromMetrics";
import { OptionService } from "../../src/services/OptionService";
import { PhotoCleanup } from "../../src/services/PhotoCleanup";
import { GapSortOrderPlanner } from "../../src/services/SortOrderPlanner";
import { FakeLogger } from "../fakes/FakeLogger";
import { FakeOptionStore, FixedClock } from "../fakes/FakeOptionStore";
import { FakePhotoFiles } from "../fakes/FakePhotoFiles";

// どの操作も同じ人として呼ぶ（人ごとに分けるのは RLS と SQL。tests/api/isolation.test.ts）
const USER = 7;
const T0 = "2026-11-01T00:00:00.000Z";
const T1 = "2026-11-01T00:01:00.000Z";

describe("OptionService", () => {
  let store: FakeOptionStore;
  let clock: FixedClock;
  let service: OptionService;
  let files: FakePhotoFiles;

  beforeEach(() => {
    store = new FakeOptionStore();
    clock = new FixedClock(T0);
    files = new FakePhotoFiles();
    service = new OptionService(store, clock, new GapSortOrderPlanner(), new PhotoCleanup(files, new PromMetrics(), new FakeLogger()));
  });

  // 1 つの操作は、その人の 1 つのトランザクション（withUser）で流す（data.md §4）
  it("runs each operation once in withUser as the given user", async () => {
    const { id } = await service.create(USER, { title: "a", suggestionId: null });
    await service.update(USER, id, { status: "completed" });
    await service.list(null, "pending");
    expect(store.users()).toEqual([USER, USER, null]);
  });

  describe("OptionService.remove and the photos", () => {
    it("removes the photo files of the option after deleting it", async () => {
      const kept = await files.save(Buffer.from("x"), "jpg");
      const removed = await files.save(Buffer.from("x"), "jpg");
      const { id } = await service.create(USER, { title: "a", suggestionId: null });
      store.givePhotos(id, [removed]);
      await service.remove(USER, id);
      expect(files.names()).toEqual([kept]);
    });

    it("leaves the files alone when the option does not exist", async () => {
      const name = await files.save(Buffer.from("x"), "jpg");
      store.givePhotos(99, [name]);
      await expect(service.remove(USER, 99)).rejects.toThrow("が見つからない");
      expect(files.names()).toEqual([name]);
    });
  });

  describe("OptionService.create", () => {
    it("puts the first option at sort order 0 and later ones above it with a gap", async () => {
      const first = await service.create(USER, { title: "a", suggestionId: null });
      const second = await service.create(USER, { title: "b", suggestionId: 3 });
      expect(store.sortOrderOf(first.id)).toBe(0);
      expect(store.sortOrderOf(second.id)).toBe(-1024);
      expect(second).toMatchObject({ title: "b", status: "pending", suggestionId: 3, createdAt: T0, updatedAt: T0 });
      expect((await service.list(USER, "pending")).map((o) => o.title)).toEqual(["b", "a"]);
    });
  });

  describe("OptionService.detail", () => {
    it("returns the option with its achievements", async () => {
      const { id } = await service.create(USER, { title: "a", suggestionId: null });
      expect(await service.detail(USER, id)).toMatchObject({ id, plannedOn: null, achievements: [] });
    });

    it("throws NOT_FOUND for an unknown id", async () => {
      await expect(service.detail(USER, 99)).rejects.toThrow("option 99 が見つからない");
    });
  });

  describe("OptionService.update", () => {
    it("sets and clears the plan date, and returns the option", async () => {
      const { id } = await service.create(USER, { title: "a", suggestionId: null });
      clock.advance(60_000);
      const set = await service.update(USER, id, { plannedOn: "2026-11-23" });
      expect(set).toMatchObject({ title: "a", plannedOn: "2026-11-23", updatedAt: T1 });
      expect(await service.update(USER, id, { plannedOn: null })).toMatchObject({ plannedOn: null });
    });

    it("lists options with a plan date first in date order, then the others in sort order", async () => {
      const a = await service.create(USER, { title: "a", suggestionId: null });
      const b = await service.create(USER, { title: "b", suggestionId: null });
      await service.create(USER, { title: "c", suggestionId: null });
      const d = await service.create(USER, { title: "d", suggestionId: null });
      await service.update(USER, a.id, { plannedOn: "2026-12-01" });
      await service.update(USER, b.id, { plannedOn: "2026-11-23" });
      await service.update(USER, d.id, { plannedOn: "2026-12-01" });
      // 同じ日（a と d）は先に追加した a が上
      expect((await service.list(USER, "pending")).map((o) => o.title)).toEqual(["b", "a", "d", "c"]);
    });

    it("moves the option to the top of the ones without a plan date when the date is cleared", async () => {
      const a = await service.create(USER, { title: "a", suggestionId: null });
      await service.create(USER, { title: "b", suggestionId: null });
      const c = await service.create(USER, { title: "c", suggestionId: null });
      await service.update(USER, a.id, { plannedOn: "2026-11-23" });
      await service.update(USER, c.id, { plannedOn: "2026-12-01" });
      await service.update(USER, a.id, { plannedOn: null });
      expect((await service.list(USER, "pending")).map((o) => o.title)).toEqual(["c", "a", "b"]);
      // 予定日がないまま null を送っても順番は変えない
      const before = store.sortOrderOf(a.id);
      await service.update(USER, a.id, { plannedOn: null });
      expect(store.sortOrderOf(a.id)).toBe(before);
    });

    it("changes only the title and updatedAt when status is not given", async () => {
      const { id } = await service.create(USER, { title: "a", suggestionId: null });
      clock.advance(60_000);
      const updated = await service.update(USER, id, { title: "b" });
      expect(updated).toMatchObject({ title: "b", status: "pending", completedAt: null, updatedAt: T1 });
      expect(store.sortOrderOf(id)).toBe(0);
    });

    it("sets completedAt and keeps the sort order when completing", async () => {
      const { id } = await service.create(USER, { title: "a", suggestionId: null });
      await service.create(USER, { title: "b", suggestionId: null });
      clock.advance(60_000);
      const updated = await service.update(USER, id, { status: "completed" });
      expect(updated).toMatchObject({ title: "a", status: "completed", completedAt: T1 });
      expect(store.sortOrderOf(id)).toBe(0);
    });

    it("clears completedAt and moves the option to the top when putting it back", async () => {
      const a = await service.create(USER, { title: "a", suggestionId: null });
      await service.create(USER, { title: "b", suggestionId: null });
      await service.update(USER, a.id, { status: "completed" });
      const back = await service.update(USER, a.id, { status: "pending" });
      expect(back).toMatchObject({ status: "pending", completedAt: null });
      expect((await service.list(USER, "pending")).map((o) => o.title)).toEqual(["a", "b"]);
    });

    it("does not touch completedAt when the status stays the same", async () => {
      const { id } = await service.create(USER, { title: "a", suggestionId: null });
      await service.update(USER, id, { status: "completed" });
      clock.advance(60_000);
      const updated = await service.update(USER, id, { status: "completed", title: "c" });
      expect(updated).toMatchObject({ title: "c", completedAt: T0, updatedAt: T1 });
    });

    it("keeps the sort order when a pending option is patched as pending", async () => {
      const { id } = await service.create(USER, { title: "a", suggestionId: null });
      await service.create(USER, { title: "b", suggestionId: null });
      const updated = await service.update(USER, id, { status: "pending" });
      expect(updated).toMatchObject({ status: "pending", completedAt: null });
      expect(store.sortOrderOf(id)).toBe(0);
      expect((await service.list(USER, "pending")).map((o) => o.title)).toEqual(["b", "a"]);
    });

    it("throws NOT_FOUND for an unknown id", async () => {
      await expect(service.update(USER, 5, { title: "x" })).rejects.toThrow("option 5 が見つからない");
    });
  });

  describe("OptionService.remove", () => {
    it("deletes the option", async () => {
      const { id } = await service.create(USER, { title: "a", suggestionId: null });
      await service.remove(USER, id);
      expect(await store.find(id)).toBeNull();
    });

    it("throws NOT_FOUND for an unknown id", async () => {
      await expect(service.remove(USER, 7)).rejects.toThrow("option 7 が見つからない");
    });
  });

  describe("OptionService.reorder", () => {
    it("reorders pending options in the given order", async () => {
      const a = await service.create(USER, { title: "a", suggestionId: null });
      const b = await service.create(USER, { title: "b", suggestionId: null });
      const c = await service.create(USER, { title: "c", suggestionId: null });
      await service.reorder(USER, [a.id, c.id, b.id]);
      expect((await service.list(USER, "pending")).map((o) => o.title)).toEqual(["a", "c", "b"]);
    });

    it("keeps pending options missing from ids at the top in their current order", async () => {
      const a = await service.create(USER, { title: "a", suggestionId: null });
      const b = await service.create(USER, { title: "b", suggestionId: null });
      const c = await service.create(USER, { title: "c", suggestionId: null });
      // 画面は a・b・c だけを知っている。そのあと別の端末で d・e が追加された
      await service.create(USER, { title: "d", suggestionId: null });
      await service.create(USER, { title: "e", suggestionId: null });
      await service.reorder(USER, [c.id, a.id, b.id]);
      expect((await service.list(USER, "pending")).map((o) => o.title)).toEqual(["e", "d", "c", "a", "b"]);
    });

    it.each([
      ["an unknown id", [1, 2, 99]],
      ["a duplicated id", [1, 1]],
      ["a completed id", [1, 3]],
    ])("rejects ids with %s", async (_label, ids) => {
      await service.create(USER, { title: "a", suggestionId: null });
      await service.create(USER, { title: "b", suggestionId: null });
      const done = await service.create(USER, { title: "c", suggestionId: null });
      await service.update(USER, done.id, { status: "completed" });
      await expect(service.reorder(USER, ids)).rejects.toThrow("ids に重複か、やりたいリストにない option がある");
    });

    it("accepts an empty list when there is no pending option", async () => {
      await expect(service.reorder(USER, [])).resolves.toBeUndefined();
    });
  });
});
