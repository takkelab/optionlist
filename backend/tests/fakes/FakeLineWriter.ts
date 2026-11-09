import type { LineWriter } from "../../src/infra/JsonLogger";

// 書いた行を出し先ごとに覚えておく
export class FakeLineWriter implements LineWriter {
  readonly #out: string[] = [];
  readonly #err: string[] = [];

  out(line: string): void {
    this.#out.push(line);
  }

  err(line: string): void {
    this.#err.push(line);
  }

  outLines(): string[] {
    return [...this.#out];
  }

  errLines(): string[] {
    return [...this.#err];
  }
}
