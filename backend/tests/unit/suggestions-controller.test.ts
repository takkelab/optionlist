import { beforeEach, describe, expect, it } from "vitest";
import { SessionLocals } from "../../src/middleware/SessionLocals";
import { PathId } from "../../src/controllers/PathId";
import { SuggestionsController } from "../../src/controllers/SuggestionsController";
import { AppError } from "../../src/services/errors";
import { SuggestionService } from "../../src/services/SuggestionService";
import { FakeResponse } from "../fakes/FakeResponse";
import { FakeSuggestionStore } from "../fakes/FakeSuggestionStore";

const USER = 7;

describe("SuggestionsController", () => {
  let controller: SuggestionsController;

  beforeEach(() => {
    const store = new FakeSuggestionStore();
    store.add(["星"]);
    controller = new SuggestionsController(new SuggestionService(store), new PathId(), new SessionLocals());
  });

  it("answers the catalog and the detail", async () => {
    const catalog = new FakeResponse();
    await controller.catalog(USER, catalog);
    expect(catalog.statusCode()).toBe(200);
    expect(catalog.body()).toMatchObject({ suggestions: [{ id: 1 }] });

    const detail = new FakeResponse();
    await controller.detail(USER, { id: "1" }, detail);
    expect(detail.body()).toMatchObject({ id: 1, tags: [{ id: 1, name: "星" }], related: [] });
  });

  // :id が正の整数でないものは存在しない提案として 404（api.md §3）
  it.each(["0", "-1", "1.5", "abc", "01", "9007199254740992", "99999999999999999", undefined])("answers NOT_FOUND for the id %s", async (id) => {
    const error = await controller.detail(USER, { id }, new FakeResponse()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code()).toBe("NOT_FOUND");
  });

  it("accepts the largest safe integer id and lets the service answer NOT_FOUND", async () => {
    const error = await controller.detail(USER, { id: "9007199254740991" }, new FakeResponse()).catch((e: unknown) => e);
    expect((error as AppError).message).toBe("suggestion 9007199254740991 が見つからない");
  });
});
