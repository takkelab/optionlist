import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { appendRow, bucketFileNames, drillInstanceName, drillRow, judgeDrill } from "../lib/restore-drill.ts";
import type { DrillInput } from "../lib/restore-drill.ts";

const base: DrillInput = {
  kept: { users: [1, 2], options: [10, 11], achievements: [100, 101] },
  restored: { users: [1, 2], options: [10, 11], achievements: [100, 101] },
  currentPhotos: new Map([[100, "a.jpg"], [101, null]]),
  restoredPhotos: new Map([[100, "a.jpg"], [101, null]]),
  bucketFiles: new Set(["a.jpg"]),
};

describe("judgeDrill", () => {
  it("S′ がすべて戻り、写真もあれば成功", () => {
    assert.deepEqual(judgeDrill(base), { ok: true, counts: { users: 2, options: 2, achievements: 2 }, missingPhotos: 0, problems: [] });
  });

  // 数え方の誤りで空どうしが一致するのを防ぐ（data.md §6 の 3）
  it("どれかの表の S′ が空なら失敗", () => {
    const result = judgeDrill({ ...base, kept: { ...base.kept, achievements: [] }, currentPhotos: new Map() });
    assert.equal(result.ok, false);
    assert.match(result.problems.join(), /achievements: .*S′ が空/);
  });

  it("S′ の ID が戻した DB になければ失敗", () => {
    const result = judgeDrill({ ...base, restored: { ...base.restored, options: [10] } });
    assert.equal(result.ok, false);
    assert.match(result.problems.join(), /options: 戻した DB にない ID が 1 件（11）/);
  });

  // 新しい行や、バックアップのあとで消えた行は R にしかない。利用者が書き続けていても崩れない
  it("R にしかない ID があっても成功", () => {
    assert.equal(judgeDrill({ ...base, restored: { users: [1, 2, 3], options: [9, 10, 11, 12], achievements: [100, 101, 102] } }).ok, true);
  });

  it("前後で写真が同じ達成のファイルが入れ物になければ失敗", () => {
    const result = judgeDrill({ ...base, bucketFiles: new Set() });
    assert.equal(result.ok, false);
    assert.equal(result.missingPhotos, 1);
  });

  // バックアップのあとで写真を付け替えた・外した達成は数えない（data.md §6 の 5）
  it("前後で写真が変わった達成は数えない", () => {
    const changed = judgeDrill({ ...base, currentPhotos: new Map([[100, "b.jpg"], [101, null]]), bucketFiles: new Set(["b.jpg"]) });
    assert.equal(changed.missingPhotos, 0);
    const removed = judgeDrill({ ...base, currentPhotos: new Map([[100, null], [101, null]]), bucketFiles: new Set() });
    assert.equal(removed.missingPhotos, 0);
  });

  it("写真があるのに行がないものは数えない", () => {
    assert.equal(judgeDrill({ ...base, bucketFiles: new Set(["a.jpg", "orphan.jpg"]) }).ok, true);
  });
});

describe("drillRow・drillInstanceName", () => {
  const now = new Date("2026-11-11T15:30:00Z"); // 日本時間の 11/12 0:30

  it("インスタンスの名前は日本時間の restore-drill-<YYYYMMDDHHmm>", () => {
    assert.equal(drillInstanceName(now), "restore-drill-202611120030");
  });

  it("成功の行は grep \"| optionlist_staging |.*| 成功 |\" に当たる", () => {
    const row = drillRow(now, "optionlist_staging", judgeDrill(base));
    assert.equal(row, "| 2026-11-12 | optionlist_staging | users 2・options 2・achievements 2 | 0 | 成功 |");
    assert.match(row, /\| optionlist_staging \|.*\| 成功 \|/);
  });

  it("判定の前に止まったら、数えずに失敗の行", () => {
    assert.equal(drillRow(now, "optionlist_production", null), "| 2026-11-12 | optionlist_production | - | - | 失敗 |");
  });

  it("表の最後に 1 行足す", () => {
    assert.equal(appendRow("| a |\n|---|\n\n", "| b |"), "| a |\n|---|\n| b |\n");
  });
});

describe("bucketFileNames", () => {
  it("gcloud storage ls の行からファイルの名前を取り出す", () => {
    const listing = "gs://optionlist-staging-photos/a.jpg\r\ngs://optionlist-staging-photos/b.jpg\n\n";
    assert.deepEqual([...bucketFileNames("optionlist-staging-photos", listing)], ["a.jpg", "b.jpg"]);
  });
});
