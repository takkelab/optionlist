import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { E2E_REPORT, E2E_UI_METRICS, E2eCollector } from "../lib/e2e-collector.ts";
import type { UiMetrics } from "../lib/e2e-collector.ts";
import type { Measurement } from "../lib/types.ts";
import { FakeCommandRunner, FakeFileSource } from "./fakes.ts";

const report = (stats: { duration: number; unexpected: number; flaky: number }): string => JSON.stringify({ stats });
const ui = (metrics: UiMetrics): string => JSON.stringify(metrics);
const silent = () => undefined;
const byId = (measurements: Measurement[], id: string): Measurement | undefined => measurements.find((m) => m.id === id);
const valueOf = (measurements: Measurement[], id: string): number | string | undefined => {
  const found = byId(measurements, id);
  return found?.kind === "value" ? found.value : found?.kind;
};

describe("E2eCollector", () => {
  it("レポートと計測結果から 4 つの指標を出す", () => {
    const files = new FakeFileSource({
      [E2E_REPORT]: report({ duration: 42_345, unexpected: 0, flaky: 0 }),
      [E2E_UI_METRICS]: ui({ lcpSec: { "/": 0.4, "/done": 0.9 }, smallTapTargets: [] }),
    });
    const runner = new FakeCommandRunner([]);
    const { measurements, checks } = new E2eCollector({ runner, files, log: silent }).collect();
    assert.deepEqual(runner.executed(), ["npm run -s test:e2e"]);
    assert.equal(valueOf(measurements, "e2e-test-duration"), 42.3);
    assert.equal(valueOf(measurements, "flaky-tests"), 0);
    assert.equal(valueOf(measurements, "lcp"), 0.9);
    assert.equal(byId(measurements, "lcp")?.detail, "最も遅い画面: /done");
    assert.equal(valueOf(measurements, "tap-target-violations"), 0);
    assert.deepEqual(checks.map((c) => c.ok), [true]);
  });

  it("44×44px 未満の要素を数えて、どれかを detail に出す", () => {
    const files = new FakeFileSource({
      [E2E_REPORT]: report({ duration: 1000, unexpected: 0, flaky: 0 }),
      [E2E_UI_METRICS]: ui({
        lcpSec: { "/": 0.4 },
        smallTapTargets: [{ screen: "/", element: "button「追加」", width: 30, height: 30 }],
      }),
    });
    const { measurements } = new E2eCollector({ runner: new FakeCommandRunner([]), files, log: silent }).collect();
    assert.equal(valueOf(measurements, "tap-target-violations"), 1);
    assert.equal(byId(measurements, "tap-target-violations")?.detail, "/ button「追加」 30×30");
  });

  it("コマンドが失敗したら、レポートの失敗が 0 件でも 1 件にし、LCP とタップ領域は計測できなかった扱いにする", () => {
    const files = new FakeFileSource({
      [E2E_REPORT]: report({ duration: 1000, unexpected: 0, flaky: 0 }),
      [E2E_UI_METRICS]: ui({ lcpSec: { "/": 0.4 }, smallTapTargets: [] }),
    });
    const runner = new FakeCommandRunner([["test:e2e", { exitCode: 1 }]]);
    const { measurements, checks } = new E2eCollector({ runner, files, log: silent }).collect();
    assert.equal(valueOf(measurements, "flaky-tests"), 1);
    assert.equal(valueOf(measurements, "lcp"), "missing");
    assert.equal(valueOf(measurements, "tap-target-violations"), "missing");
    assert.deepEqual(checks.map((c) => c.ok), [false]);
  });

  it("失敗したテストの数をそのまま数える（retries: 0 なので flaky も失敗に含める）", () => {
    const files = new FakeFileSource({ [E2E_REPORT]: report({ duration: 1000, unexpected: 2, flaky: 1 }) });
    const runner = new FakeCommandRunner([["test:e2e", { exitCode: 1 }]]);
    const { measurements } = new E2eCollector({ runner, files, log: silent }).collect();
    assert.equal(valueOf(measurements, "flaky-tests"), 3);
  });

  it("レポートが出ていなければ、時間はコマンド全体で測り、失敗の件数は計測できなかった扱いにする", () => {
    const runner = new FakeCommandRunner([["test:e2e", { exitCode: 1, durationSec: 7 }]]);
    const { measurements } = new E2eCollector({ runner, files: new FakeFileSource({}), log: silent }).collect();
    assert.equal(valueOf(measurements, "e2e-test-duration"), 7);
    assert.equal(valueOf(measurements, "flaky-tests"), "missing");
  });

  it("成功しても計測結果がなければ、LCP とタップ領域は計測できなかった扱いにする", () => {
    const files = new FakeFileSource({ [E2E_REPORT]: report({ duration: 1000, unexpected: 0, flaky: 0 }) });
    const { measurements } = new E2eCollector({ runner: new FakeCommandRunner([]), files, log: silent }).collect();
    assert.equal(valueOf(measurements, "lcp"), "missing");
    assert.equal(byId(measurements, "lcp")?.detail, "計測結果（JSON）が出ていない");
  });

  it("LCP を測った画面が 1 つもなければ計測できなかった扱いにする", () => {
    const files = new FakeFileSource({
      [E2E_REPORT]: report({ duration: 1000, unexpected: 0, flaky: 0 }),
      [E2E_UI_METRICS]: ui({ lcpSec: {}, smallTapTargets: [] }),
    });
    const { measurements } = new E2eCollector({ runner: new FakeCommandRunner([]), files, log: silent }).collect();
    assert.equal(valueOf(measurements, "lcp"), "missing");
  });
});
