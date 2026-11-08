import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type PerfMeasurement = { id: string; value: number; detail?: string };

export interface PerfReport {
  record(measurement: PerfMeasurement): void;
  write(path: string): void;
}

// 性能テストの結果。ID は metrics.config.json と同じ。判定は metrics:check（scripts/lib/perf-collector.ts）が行う
export class PerfResults implements PerfReport {
  readonly #measurements: PerfMeasurement[] = [];

  record(measurement: PerfMeasurement): void {
    this.#measurements.push(measurement);
  }

  write(path: string): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify({ measurements: this.#measurements }, null, 2)}\n`);
  }
}
