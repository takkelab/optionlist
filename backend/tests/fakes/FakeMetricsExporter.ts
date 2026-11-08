import type { MetricsExporter } from "../../src/metrics/AppMetrics";

export class FakeMetricsExporter implements MetricsExporter {
  readonly #text: string;

  constructor(text: string) {
    this.#text = text;
  }

  contentType(): string {
    return "text/plain; version=0.0.4; charset=utf-8";
  }

  async render(): Promise<string> {
    return this.#text;
  }
}
