import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RequiredChecksMergeGate } from "../lib/merge-gate.ts";

const run = (name: string, conclusion: string, startedAt: string, status = "COMPLETED") => ({
  name,
  status,
  conclusion,
  startedAt,
});

describe("RequiredChecksMergeGate", () => {
  const gate = new RequiredChecksMergeGate(["quality", "pr-check"]);

  it("必須のチェックがすべて最新の実行で成功していれば空", () => {
    const checks = [
      run("quality", "SUCCESS", "2026-11-01T03:49:00Z"),
      run("pr-check", "SKIPPED", "2026-11-01T03:49:00Z"),
      run("pr-check", "FAILURE", "2026-11-01T03:50:00Z"),
      run("pr-check", "SUCCESS", "2026-11-01T03:52:00Z"),
    ];
    assert.deepEqual(gate.blockers(checks), []);
  });

  it("最新の実行が失敗していればマージしない（古い成功では通さない）", () => {
    const checks = [
      run("quality", "SUCCESS", "2026-11-01T03:49:00Z"),
      run("pr-check", "SUCCESS", "2026-11-01T03:49:00Z"),
      run("pr-check", "FAILURE", "2026-11-01T03:50:00Z"),
    ];
    assert.deepEqual(gate.blockers(checks), ["pr-check が FAILURE"]);
  });

  it("実行中のチェックや、結果のない必須チェックがあればマージしない", () => {
    const checks = [
      run("quality", "", "2026-11-01T03:49:00Z", "IN_PROGRESS"),
      run("pr-check", "SKIPPED", "2026-11-01T03:49:00Z"),
    ];
    assert.deepEqual(gate.blockers(checks), ["quality が実行中", "quality の結果がない", "pr-check の結果がない"]);
  });
});
