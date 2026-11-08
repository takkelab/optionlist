import { beforeEach, describe, expect, it } from "vitest";
import { AppError } from "../../src/services/errors";
import { SuggestionService } from "../../src/services/SuggestionService";
import { FakeSuggestionStore } from "../fakes/FakeSuggestionStore";

describe("SuggestionService", () => {
  let store: FakeSuggestionStore;
  let service: SuggestionService;

  beforeEach(() => {
    store = new FakeSuggestionStore();
    service = new SuggestionService(store);
  });

  it("returns the catalog from the store", async () => {
    store.add(["星", "夜"]);
    const { suggestions, tags } = await service.catalog();
    expect(suggestions).toEqual([expect.objectContaining({ id: 1, tagIds: [1, 2] })]);
    expect(tags).toEqual([
      { id: 1, name: "星" },
      { id: 2, name: "夜" },
    ]);
  });

  it("orders related suggestions by the number of shared tags, then by id", async () => {
    const me = store.add(["星", "夜", "観察"]);
    store.add(["星"]); // 2: 1 個
    store.add(["星", "夜"]); // 3: 2 個
    store.add(["料理"]); // 4: 共有なし
    store.add(["夜", "観察"]); // 5: 2 個
    store.add(["星", "夜", "観察"]); // 6: 3 個

    const { related } = await service.detail(me);
    expect(related.map((s) => s.id)).toEqual([6, 3, 5, 2]);
  });

  it("returns at most 5 related suggestions without the shared count", async () => {
    const me = store.add(["星"]);
    for (let i = 0; i < 7; i++) store.add(["星"]);

    const { related } = await service.detail(me);
    expect(related.map((s) => s.id)).toEqual([2, 3, 4, 5, 6]);
    expect(related[0]).not.toHaveProperty("shared");
  });

  it("returns the body with its tags", async () => {
    const me = store.add(["星", "夜"], { seasonFrom: 12, seasonTo: 2, optionStatus: "completed" });

    expect(await service.detail(me)).toEqual(
      expect.objectContaining({
        id: me,
        seasonFrom: 12,
        seasonTo: 2,
        optionStatus: "completed",
        trivia: "豆知識 1",
        firstStep: "一歩 1",
        tags: [
          { id: 1, name: "星" },
          { id: 2, name: "夜" },
        ],
        related: [],
      }),
    );
  });

  it("throws NOT_FOUND without reading the related candidates for an unknown suggestion", async () => {
    const error = await service.detail(99).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code()).toBe("NOT_FOUND");
    expect(store.candidateCalls()).toBe(0);
  });
});
