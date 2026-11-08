import { describe, expect, it } from "vitest";
import { FullScanFinder } from "../fakes/FullScanFinder";

// 性能テスト（metrics.md §4 のフルテーブルスキャン）で使う判定
describe("FullScanFinder", () => {
  const finder = new FullScanFinder(["suggestions", "themes"]);

  it("resolves the aliases and skips the ignored tables", () => {
    const sql = "SELECT s.id FROM suggestions s LEFT JOIN options o ON o.suggestion_id = s.id ORDER BY s.id";
    const plan = [
      { table: "s", type: "ALL" },
      { table: "o", type: "ALL" },
    ];
    expect(finder.fullScans(sql, plan)).toEqual(["options"]);
  });

  it("counts only type = ALL and handles tables without an alias", () => {
    const sql = "SELECT id FROM themes; SELECT id FROM options WHERE status = 'pending'";
    const plan = [
      { table: "themes", type: "ALL" },
      { table: "options", type: "ALL" },
      { table: "achievements", type: "ref" },
    ];
    expect(finder.fullScans(sql, plan)).toEqual(["options"]);
  });

  it("does not take a keyword after the table as its alias", () => {
    const sql = "SELECT t.id FROM suggestion_tags st JOIN tags ON tags.id = st.tag_id WHERE st.suggestion_id = 1";
    expect(finder.fullScans(sql, [{ table: "tags", type: "ALL" }])).toEqual(["tags"]);
  });
});
