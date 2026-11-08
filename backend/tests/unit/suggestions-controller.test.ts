import { beforeEach, describe, expect, it } from "vitest";
import { PathId } from "../../src/controllers/PathId";
import { SuggestionsController } from "../../src/controllers/SuggestionsController";
import { AppError } from "../../src/services/errors";
import { SuggestionService } from "../../src/services/SuggestionService";
import { FakeResponse } from "../fakes/FakeResponse";
import { FakeSuggestionStore } from "../fakes/FakeSuggestionStore";

describe("SuggestionsController", () => {
  let controller: SuggestionsController;

  beforeEach(() => {
    const store = new FakeSuggestionStore();
    store.add(["星"]);
    controller = new SuggestionsController(new SuggestionService(store), new PathId());
  });

  it("answers the catalog and the detail", async () => {
    const catalog = new FakeResponse();
    await controller.catalog(catalog);
    expect(catalog.statusCode()).toBe(200);
    expect(catalog.body()).toMatchObject({ suggestions: [{ id: 1 }] });

    const detail = new FakeResponse();
    await controller.detail({ id: "1" }, detail);
    expect(detail.body()).toMatchObject({ id: 1, tags: [{ id: 1, name: "星" }], related: [] });
  });

  // :id が正の整数でないものは存在しない提案として 404（api.md §3）
  it.each(["0", "-1", "1.5", "abc", "01", "4294967296", "99999999999", undefined])("answers NOT_FOUND for the id %s", async (id) => {
    const error = await controller.detail({ id }, new FakeResponse()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code()).toBe("NOT_FOUND");
  });

  it("accepts the largest INT UNSIGNED id and lets the service answer NOT_FOUND", async () => {
    const error = await controller.detail({ id: "4294967295" }, new FakeResponse()).catch((e: unknown) => e);
    expect((error as AppError).message).toBe("suggestion 4294967295 が見つからない");
  });
});
