import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GhStackedPrRetargeter } from "../lib/stacked-prs.ts";
import { FakeCommandRunner } from "./fakes.ts";

describe("GhStackedPrRetargeter", () => {
  it("土台のブランチに向けて積んだ PR を、すべて土台の base に向け直す", () => {
    const runner = new FakeCommandRunner([
      ["gh pr list --base feat/a", { output: '[{"number":29},{"number":32}]' }],
      ["gh pr edit", { exitCode: 0 }],
    ]);
    const result = new GhStackedPrRetargeter(runner).retarget("feat/a", "main");
    assert.deepEqual(result, { retargeted: [29, 32], problem: null });
    assert.deepEqual(runner.executed().slice(1), ["gh pr edit 29 --base main", "gh pr edit 32 --base main"]);
  });

  it("積み重ねた PR がなければ何もしない", () => {
    const runner = new FakeCommandRunner([["gh pr list", { output: "[]" }]]);
    assert.deepEqual(new GhStackedPrRetargeter(runner).retarget("feat/a", "main"), { retargeted: [], problem: null });
    assert.equal(runner.executed().length, 1);
  });

  it("向け直せなかったら、その PR と理由を返して止まる", () => {
    const runner = new FakeCommandRunner([
      ["gh pr list", { output: '[{"number":29},{"number":32}]' }],
      ["gh pr edit 29", { exitCode: 1, output: "denied" }],
    ]);
    const result = new GhStackedPrRetargeter(runner).retarget("feat/a", "main");
    assert.deepEqual(result.retargeted, []);
    assert.match(result.problem ?? "", /#29.*denied/);
  });

  it("一覧を取れなかったら理由を返す", () => {
    const runner = new FakeCommandRunner([["gh pr list", { exitCode: 1, output: "offline" }]]);
    assert.match(new GhStackedPrRetargeter(runner).retarget("feat/a", "main").problem ?? "", /offline/);
  });
});
