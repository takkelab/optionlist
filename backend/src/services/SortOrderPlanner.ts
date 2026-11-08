import type { SortOrderEntry } from "../repositories/OptionRepository";

export interface SortOrderPlan {
  // current は今の sort_order、ids は並べたい順。返すのは sort_order を変える行だけ
  plan(current: SortOrderEntry[], ids: number[]): SortOrderEntry[];
  // 先頭に入れるときの値。min は pending の最小値（pending がなければ null）
  top(min: number | null): number;
}

// 値の間隔。間に後から入れられるよう隙間を空ける（先頭への追加も同じ）
const GAP = 1024;

// 並び替えで書き換える行をできるだけ少なくする（1 件動かしただけなら 1 行。docs/decisions/0009）
// 新しい並びのうち、今の sort_order の順のままでよい最長の部分（最長増加部分列）はそのまま残し、
// 残りの行に前後の値の間の値を入れる。間に入る整数がなければ全件を GAP 刻みで振り直す
export class GapSortOrderPlanner implements SortOrderPlan {
  plan(current: SortOrderEntry[], ids: number[]): SortOrderEntry[] {
    const before = new Map(current.map((e) => [e.id, e.sortOrder]));
    const orders = ids.map((id) => before.get(id) ?? 0);
    const next = this.#fill(orders, this.#increasingIndexes(orders)) ?? ids.map((_, i) => (i + 1) * GAP);
    return ids.map((id, i) => ({ id, sortOrder: next[i] ?? 0 })).filter((e) => e.sortOrder !== before.get(e.id));
  }

  top(min: number | null): number {
    return min === null ? 0 : min - GAP;
  }

  // 残す行はそのままの値、動かす行は前後の残す行の間の値にする。入らなければ null
  #fill(orders: number[], kept: Set<number>): number[] | null {
    const next = [...orders];
    let start = 0;
    while (start < orders.length) {
      if (kept.has(start)) {
        start++;
        continue;
      }
      let end = start;
      while (end + 1 < orders.length && !kept.has(end + 1)) end++;
      const values = this.#between(start > 0 ? next[start - 1] : undefined, orders[end + 1], end - start + 1);
      if (values === null) return null;
      next.splice(start, values.length, ...values);
      start = end + 1;
    }
    return next;
  }

  // lo と hi の間（両端を含まない）に count 個の増加する整数を入れる。lo・hi がなければ端なので GAP 刻み
  #between(lo: number | undefined, hi: number | undefined, count: number): number[] | null {
    const indexes = Array.from({ length: count }, (_, i) => i);
    if (lo === undefined && hi === undefined) return indexes.map((i) => (i + 1) * GAP);
    if (lo === undefined) return indexes.map((i) => (hi ?? 0) - (count - i) * GAP);
    if (hi === undefined) return indexes.map((i) => lo + (i + 1) * GAP);
    const step = Math.floor((hi - lo) / (count + 1));
    return step < 1 ? null : indexes.map((i) => lo + (i + 1) * step);
  }

  // 最長増加部分列の添字（O(n log n)）
  #increasingIndexes(values: number[]): Set<number> {
    const tails: number[] = [];
    const previous: number[] = [];
    values.forEach((value, i) => {
      let lo = 0;
      let hi = tails.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if ((values[tails[mid] ?? 0] ?? 0) < value) lo = mid + 1;
        else hi = mid;
      }
      previous[i] = lo > 0 ? (tails[lo - 1] ?? -1) : -1;
      tails[lo] = i;
    });
    const kept = new Set<number>();
    for (let i = tails.at(-1) ?? -1; i >= 0; i = previous[i] ?? -1) kept.add(i);
    return kept;
  }
}
