import type { RandomIndex } from "../../src/services/RecoveryCodes";

// 決まった値を順に返し、使い切ったら最初に戻る（max で割った余りを返すので、max より大きい値も渡せる）
export class SequenceRandom implements RandomIndex {
  readonly #values: number[];
  #at = 0;

  constructor(values: number[]) {
    this.#values = [...values];
  }

  below(max: number): number {
    const value = this.#values[this.#at % this.#values.length] ?? 0;
    this.#at++;
    return value % max;
  }
}
