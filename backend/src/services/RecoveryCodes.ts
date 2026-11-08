import { randomInt } from "node:crypto";

// 0 から max - 1 までの整数。UT では決まった値を返すフェイクを渡す
export interface RandomIndex {
  below(max: number): number;
}

export class CryptoRandomIndex implements RandomIndex {
  below(max: number): number {
    return randomInt(max);
  }
}

// 復旧コード（data.md §3）。作るときは 4 文字ずつハイフンで区切り、比べるときは正規化した 16 文字を使う
export interface RecoveryCodeSource {
  // 新しいコード（ABCD-EFGH-JKMN-PQRS の形）
  next(): string;
  // 空白・ハイフンを除いて大文字にした 16 文字。形が違えば null
  normalize(input: string): string | null;
}

// 見分けにくい 0・O・1・I・L を除いた数字と大文字（31 文字）
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const LENGTH = 16;
const GROUP = 4;
const VALID = new RegExp(`^[${ALPHABET}]{${LENGTH}}$`);

export class RecoveryCodes implements RecoveryCodeSource {
  readonly #random: RandomIndex;

  constructor(random: RandomIndex) {
    this.#random = random;
  }

  next(): string {
    const chars: string[] = [];
    for (let i = 0; i < LENGTH; i++) chars.push(ALPHABET.charAt(this.#random.below(ALPHABET.length)));
    const groups: string[] = [];
    for (let i = 0; i < LENGTH; i += GROUP) groups.push(chars.slice(i, i + GROUP).join(""));
    return groups.join("-");
  }

  normalize(input: string): string | null {
    const compact = input.replace(/[\s\-‐－ー]/gu, "").toUpperCase();
    return VALID.test(compact) ? compact : null;
  }
}
