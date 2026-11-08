import { describe, expect, it } from "vitest";
import { OptionInput } from "../../src/controllers/OptionInput";
import { PathId } from "../../src/controllers/PathId";
import { AppError } from "../../src/services/errors";

const input = new OptionInput(new PathId());

describe("OptionInput.status", () => {
  it.each(["pending", "completed"])("accepts %s", (status) => {
    expect(input.status(status)).toBe(status);
  });

  // 値をそれぞれ配列に包む（裸の配列を渡すと it.each が引数として展開し、名前の表示がずれる）
  it.each([[undefined], ["done"], [["pending"]]])("rejects %j", (status) => {
    expect(() => input.status(status)).toThrow("status は pending か completed");
  });
});

describe("OptionInput.id", () => {
  it("parses a positive integer", () => {
    expect(input.id("42")).toBe(42);
    expect(input.id("4294967295")).toBe(4_294_967_295);
  });

  // INT UNSIGNED を超える ID は SQL に渡すと範囲外のエラー（500）になるので、ここで 404 にする
  it.each([undefined, "0", "-1", "1.5", "abc", "01", "4294967296", "9999999999", "99999999999"])("treats %j as not found", (id) => {
    expect(() => input.id(id)).toThrow(AppError);
    expect(() => input.id(id)).toThrow("が見つからない");
  });
});

describe("OptionInput.newOption", () => {
  it("trims the title and defaults suggestionId to null", () => {
    expect(input.newOption({ title: "  海に行く  " })).toEqual({ title: "海に行く", suggestionId: null });
    // 全角スペース（U+3000）も前後の空白として除く（data.md §3）
    expect(input.newOption({ title: "　海に行く　" })).toEqual({ title: "海に行く", suggestionId: null });
    expect(input.newOption({ title: "a", suggestionId: null })).toEqual({ title: "a", suggestionId: null });
    expect(input.newOption({ title: "a", suggestionId: 12 })).toEqual({ title: "a", suggestionId: 12 });
  });

  it("counts emoji as one character each", () => {
    const { title } = input.newOption({ title: "🎉".repeat(200) });
    expect(title).toHaveLength(400);
    expect(() => input.newOption({ title: "🎉".repeat(201) })).toThrow("1〜200 文字");
  });

  it.each([{}, { title: 1 }, { title: "   " }, { title: "　　" }, { title: "a".repeat(201) }])("rejects the title of %j", (body) => {
    expect(() => input.newOption(body)).toThrow("title は");
  });

  it.each([0, -1, 1.5, "3"])("rejects suggestionId %j", (suggestionId) => {
    expect(() => input.newOption({ title: "a", suggestionId })).toThrow("suggestionId は");
  });

  it("treats a suggestionId beyond INT UNSIGNED as an unknown suggestion", () => {
    expect(input.newOption({ title: "a", suggestionId: 4_294_967_295 })).toEqual({ title: "a", suggestionId: 4_294_967_295 });
    expect(() => input.newOption({ title: "a", suggestionId: 4_294_967_296 })).toThrow("提案が見つからない");
  });

  it.each([[undefined], [null], ["text"], [[1]]])("rejects the body %j", (body) => {
    expect(() => input.newOption(body)).toThrow("本文は JSON のオブジェクト");
  });
});

describe("OptionInput.patch", () => {
  it("accepts title, status or both", () => {
    expect(input.patch({ title: " b " })).toMatchObject({ title: "b", status: undefined });
    expect(input.patch({ status: "completed" })).toMatchObject({ title: undefined, status: "completed" });
    expect(input.patch({ title: "b", status: "pending" })).toMatchObject({ title: "b", status: "pending" });
  });

  it("leaves out plannedOn when it is not given, and keeps null to clear it", () => {
    expect(input.patch({ title: "b" })).toMatchObject({ plannedOn: undefined });
    expect(input.patch({ plannedOn: null })).toEqual({ title: undefined, status: undefined, plannedOn: null });
  });

  it.each(["2026-11-23", "2028-02-29", "1000-01-01", "9999-12-31"])("accepts the date %s", (plannedOn) => {
    expect(input.patch({ plannedOn })).toMatchObject({ plannedOn });
  });

  it.each([["2026-02-29"], ["2026-13-01"], ["2026-11-31"], ["0999-12-31"], ["2026-1-5"], ["2026-11-23T00:00:00Z"], [20261123], [""]])(
    "rejects the date %j",
    (plannedOn) => {
      expect(() => input.patch({ plannedOn })).toThrow("plannedOn は実在する日付の YYYY-MM-DD");
    },
  );

  it("rejects a body without anything to update", () => {
    expect(() => input.patch({})).toThrow("title・status・plannedOn のどれかが必要");
  });

  it("rejects an invalid title or status", () => {
    expect(() => input.patch({ title: "" })).toThrow("title は");
    expect(() => input.patch({ status: "done" })).toThrow("status は");
  });
});

describe("OptionInput.ids", () => {
  it("accepts an array of positive integers", () => {
    expect(input.ids({ ids: [3, 1, 2] })).toEqual([3, 1, 2]);
    expect(input.ids({ ids: [] })).toEqual([]);
  });

  it.each([{}, { ids: "1,2" }, { ids: [1, "2"] }, { ids: [0] }])("rejects %j", (body) => {
    expect(() => input.ids(body)).toThrow("ids は");
  });
});
