import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GhCliCheck } from "../lib/gh-cli-check.ts";
import { FakeCommandRunner } from "./fakes.ts";

describe("GhCliCheck", () => {
  it("gh が動けば問題なし", () => {
    assert.equal(new GhCliCheck(new FakeCommandRunner([["gh --version", { exitCode: 0 }]])).problem(), null);
  });

  it("gh が動かなければ、VS Code の再起動を案内する", () => {
    const problem = new GhCliCheck(new FakeCommandRunner([["gh --version", { exitCode: 127 }]])).problem();
    assert.match(problem ?? "", /VS Code を再起動/);
  });
});
