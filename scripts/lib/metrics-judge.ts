import type { Measurement, MetricDefinition, MetricResult, MetricsConfig, Outcome } from "./types.ts";

export interface MetricsJudge {
  judge(measurements: Measurement[]): MetricResult[];
}

// metrics.config.json の目標値と計測値を比べる
export class TargetMetricsJudge implements MetricsJudge {
  readonly #definitions: MetricDefinition[];

  constructor(config: MetricsConfig) {
    this.#definitions = config.metrics;
  }

  judge(measurements: Measurement[]): MetricResult[] {
    const unknown = measurements.filter((m) => !this.#definitions.some((d) => d.id === m.id));
    if (unknown.length > 0) {
      throw new Error(`metrics.config.json にない指標: ${unknown.map((m) => m.id).join(", ")}`);
    }
    return this.#definitions.map((definition) => {
      const measurement = measurements.find((m) => m.id === definition.id);
      return this.#judgeOne(definition, measurement);
    });
  }

  #judgeOne(definition: MetricDefinition, measurement: Measurement | undefined): MetricResult {
    if (measurement === undefined) {
      return { definition, outcome: "notMeasured", detail: `ステップ ${definition.since} で導入` };
    }
    if (measurement.kind === "notApplicable") {
      return { definition, outcome: "notApplicable", detail: measurement.detail };
    }
    if (measurement.kind === "missing") {
      return { definition, outcome: this.#missedOutcome(definition), detail: `計測できなかった: ${measurement.detail}` };
    }
    const { value, detail } = measurement;
    const met = definition.op === "min" ? value >= definition.target : value <= definition.target;
    if (met) return { definition, outcome: "pass", value, detail };
    return { definition, outcome: this.#missedOutcome(definition), value, detail };
  }

  #missedOutcome(definition: MetricDefinition): Outcome {
    return definition.judge === "fail" ? "fail" : definition.judge === "warn" ? "warn" : "observed";
  }
}
