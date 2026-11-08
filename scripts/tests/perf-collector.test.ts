import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TargetMetricsJudge } from "../lib/metrics-judge.ts";
import { PERF_METRIC_IDS, PERF_RESULTS, PerfCollector } from "../lib/perf-collector.ts";
import type { MetricDefinition } from "../lib/types.ts";
import { FakeCommandRunner, FakeFileSource, SequenceFileSource } from "./fakes.ts";

const definition = (id: string): MetricDefinition => ({
  id,
  section: "§4",
  label: id,
  op: "max",
  target: 50,
  unit: "ms",
  judge: "fail",
  since: "3",
});
const judge = new TargetMetricsJudge({ metrics: PERF_METRIC_IDS.map(definition) });
// すべての指標を value にした results.json
const results = (value: number, overrides: Record<string, number> = {}): string =>
  JSON.stringify({ measurements: PERF_METRIC_IDS.map((id) => ({ id, value: overrides[id] ?? value, detail: `${value}` })) });
const silent = () => undefined;

describe("PerfCollector", () => {
  it("目標を満たしていれば 1 回だけ測る", () => {
    const runner = new FakeCommandRunner([]);
    const files = new SequenceFileSource(PERF_RESULTS, [results(10)]);
    const collected = new PerfCollector({ runner, files, judge, retries: 1, log: silent }).collect();
    assert.equal(runner.executed().length, 1);
    assert.deepEqual(
      collected.measurements.map((m) => (m.kind === "value" ? m.value : m.kind)),
      PERF_METRIC_IDS.map(() => 10),
    );
    assert.deepEqual(collected.checks.map((c) => c.ok), [true]);
  });

  it("目標を割ったら測り直し、2 回目の結果を使う", () => {
    const runner = new FakeCommandRunner([]);
    const files = new SequenceFileSource(PERF_RESULTS, [results(99), results(20)]);
    const collected = new PerfCollector({ runner, files, judge, retries: 1, log: silent }).collect();
    assert.equal(runner.executed().length, 2);
    assert.ok(collected.measurements.every((m) => m.kind === "value" && m.value === 20));
  });

  it("2 回とも割ったら 2 回目の値（失敗）を返し、それ以上は測らない", () => {
    const runner = new FakeCommandRunner([]);
    const files = new SequenceFileSource(PERF_RESULTS, [results(99), results(98), results(10)]);
    const collected = new PerfCollector({ runner, files, judge, retries: 1, log: silent }).collect();
    assert.equal(runner.executed().length, 2);
    assert.ok(judge.judge(collected.measurements).every((r) => r.outcome === "fail"));
  });

  it("指標ごとに、どちらかの回で目標を満たせば合格にする（2 回とも割った指標だけが失敗）", () => {
    const runner = new FakeCommandRunner([]);
    // 1 回目は read が、2 回目は write が割れる。どちらも 2 回とも割ってはいない
    const first = results(10, { "read-api-p95": 99 });
    const second = results(20, { "write-api-p95": 99 });
    const files = new SequenceFileSource(PERF_RESULTS, [first, second]);
    const collected = new PerfCollector({ runner, files, judge, retries: 1, log: silent }).collect();
    assert.equal(runner.executed().length, 2);
    assert.ok(judge.judge(collected.measurements).every((r) => r.outcome === "pass"));
    const values = Object.fromEntries(collected.measurements.map((m) => [m.id, m.kind === "value" ? m.value : null]));
    assert.equal(values["read-api-p95"], 20);
    assert.equal(values["write-api-p95"], 10);
  });

  it("コマンドが失敗したら、結果ファイルが残っていても missing にし、測り直さない", () => {
    const runner = new FakeCommandRunner([["test:perf", { exitCode: 1 }]]);
    const files = new FakeFileSource({ [PERF_RESULTS]: results(10) });
    const collected = new PerfCollector({ runner, files, judge, retries: 1, log: silent }).collect();
    assert.equal(runner.executed().length, 1);
    assert.ok(collected.measurements.every((m) => m.kind === "missing"));
    assert.deepEqual(collected.checks.map((c) => c.ok), [false]);
  });

  it("結果ファイルがない、または値が足りなければ missing にする", () => {
    const none = new PerfCollector({
      runner: new FakeCommandRunner([]),
      files: new FakeFileSource({}),
      judge,
      retries: 0,
      log: silent,
    }).collect();
    assert.ok(none.measurements.every((m) => m.kind === "missing"));

    const partial = JSON.stringify({ measurements: [{ id: "read-api-p95", value: 10 }] });
    const collected = new PerfCollector({
      runner: new FakeCommandRunner([]),
      files: new FakeFileSource({ [PERF_RESULTS]: partial }),
      judge,
      retries: 0,
      log: silent,
    }).collect();
    assert.deepEqual(
      collected.measurements.filter((m) => m.kind === "missing").map((m) => m.id),
      PERF_METRIC_IDS.filter((id) => id !== "read-api-p95"),
    );
  });
});
