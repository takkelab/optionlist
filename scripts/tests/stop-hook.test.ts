import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, describe, it } from "node:test";
import { StopHook } from "../lib/stop-hook.ts";
import { FakeCommandRunner } from "./fakes.ts";

// .claude/settings.json の Stop hook（docs/harness/incidents.md #18）
const SCRIPT = resolve(import.meta.dirname, "../stop-hook.ts");
const dirs: string[] = [];
const folder = (withModules: string[]): string => {
  const dir = mkdtempSync(join(tmpdir(), "optionlist-stop-hook-"));
  dirs.push(dir);
  for (const sub of withModules) mkdirSync(join(dir, sub, "node_modules"), { recursive: true });
  return dir;
};

describe("stop-hook", () => {
  after(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  it("依存がないフォルダでは、初回の手順を流すよう言って止まる（型チェックは流さない）", () => {
    const result = spawnSync(process.execPath, [SCRIPT, folder([])], { encoding: "utf8" });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /CLAUDE\.md の初回の手順を流す/);
    assert.match(result.stderr, /ルート・backend・frontend に node_modules がない/);
  });

  it("一部だけ足りないときは、そのフォルダを名指しする", () => {
    const runner = new FakeCommandRunner([]);
    const result = new StopHook(folder([".", "backend"]), runner).check();
    assert.equal(result.exitCode, 2);
    assert.match(result.message, /（frontend に node_modules がない）/);
    assert.deepEqual(runner.executed(), []);
  });

  it("依存がそろっていれば型チェックを流し、通れば止めない", () => {
    const runner = new FakeCommandRunner([["typecheck", { exitCode: 0 }]]);
    assert.deepEqual(new StopHook(folder([".", "backend", "frontend"]), runner).check(), { exitCode: 0, message: "" });
    assert.deepEqual(runner.executed(), ["npm run -s typecheck"]);
  });

  it("型チェックが落ちたら、その出力を見せて止める", () => {
    const runner = new FakeCommandRunner([["typecheck", { exitCode: 1, output: "error TS2322" }]]);
    assert.deepEqual(new StopHook(folder([".", "backend", "frontend"]), runner).check(), { exitCode: 2, message: "error TS2322" });
  });
});
