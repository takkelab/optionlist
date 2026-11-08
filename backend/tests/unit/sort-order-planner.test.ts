import { describe, expect, it } from "vitest";
import type { SortOrderEntry } from "../../src/repositories/OptionRepository";
import { GapSortOrderPlanner } from "../../src/services/SortOrderPlanner";

const planner = new GapSortOrderPlanner();
// id 1〜5 が sort_order 1〜5（隙間なし）
const TIGHT: SortOrderEntry[] = [1, 2, 3, 4, 5].map((id) => ({ id, sortOrder: id }));
// id 1〜5 が sort_order 1024 刻み
const SPACED: SortOrderEntry[] = [1, 2, 3, 4, 5].map((id) => ({ id, sortOrder: id * 1024 }));

describe("GapSortOrderPlanner", () => {
  it("puts a new top option one gap above the current top", () => {
    expect(planner.top(null)).toBe(0);
    expect(planner.top(-1024)).toBe(-2048);
  });

  it("changes nothing when the order is the same", () => {
    expect(planner.plan(TIGHT, [1, 2, 3, 4, 5])).toEqual([]);
    expect(planner.plan([], [])).toEqual([]);
  });

  it("moves one option to the top or the bottom by changing only that row", () => {
    expect(planner.plan(TIGHT, [5, 1, 2, 3, 4])).toEqual([{ id: 5, sortOrder: 1 - 1024 }]);
    expect(planner.plan(TIGHT, [2, 3, 4, 5, 1])).toEqual([{ id: 1, sortOrder: 5 + 1024 }]);
  });

  it("puts a moved option between its new neighbours when there is room", () => {
    expect(planner.plan(SPACED, [1, 5, 2, 3, 4])).toEqual([{ id: 5, sortOrder: 1536 }]);
  });

  it("renumbers every option with gaps when there is no room", () => {
    expect(planner.plan(TIGHT, [1, 5, 2, 3, 4])).toEqual([
      { id: 1, sortOrder: 1024 },
      { id: 5, sortOrder: 2048 },
      { id: 2, sortOrder: 3072 },
      { id: 3, sortOrder: 4096 },
      { id: 4, sortOrder: 5120 },
    ]);
  });

  it.each([
    [[5, 4, 3, 2, 1]],
    [[2, 1, 4, 3, 5]],
    [[3, 5, 1, 4, 2]],
    [[1, 3, 2, 5, 4]],
  ])("keeps the result strictly increasing for %j", (ids) => {
    for (const current of [TIGHT, SPACED]) {
      // plan の結果を当てはめた後の sort_order を、ids の順に並べる
      const after = new Map(current.map((e) => [e.id, e.sortOrder]));
      for (const e of planner.plan(current, ids)) after.set(e.id, e.sortOrder);
      const orders = ids.map((id) => after.get(id) ?? Number.NaN);
      expect(orders.every((order, i) => i === 0 || (orders[i - 1] ?? Number.NaN) < order)).toBe(true);
    }
  });
});
