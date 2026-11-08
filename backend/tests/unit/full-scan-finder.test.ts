import { describe, expect, it } from "vitest";
import { FullScanFinder } from "../fakes/FullScanFinder";

// 性能テスト（metrics.md §4 のフルテーブルスキャン）で使う判定。plan は EXPLAIN (FORMAT JSON) の形
describe("FullScanFinder", () => {
  const finder = new FullScanFinder(["suggestions", "themes"]);

  it("finds Seq Scan nodes anywhere in the tree and skips the ignored tables", () => {
    const plan = [
      {
        Plan: {
          "Node Type": "Hash Right Join",
          Plans: [
            { "Node Type": "Seq Scan", "Relation Name": "options", Alias: "o" },
            { "Node Type": "Hash", Plans: [{ "Node Type": "Seq Scan", "Relation Name": "suggestions", Alias: "s" }] },
          ],
        },
      },
    ];
    expect(finder.fullScans(plan)).toEqual(["options"]);
  });

  it("does not count index scans", () => {
    const plan = [
      {
        Plan: {
          "Node Type": "Nested Loop",
          Plans: [
            { "Node Type": "Index Scan", "Relation Name": "options" },
            { "Node Type": "Index Only Scan", "Relation Name": "achievements" },
            { "Node Type": "Bitmap Heap Scan", "Relation Name": "events" },
          ],
        },
      },
    ];
    expect(finder.fullScans(plan)).toEqual([]);
  });

  it("returns nothing for a result that is not a plan", () => {
    expect(finder.fullScans(null)).toEqual([]);
    expect(finder.fullScans([{ Plan: { "Node Type": "Result" } }])).toEqual([]);
  });
});
