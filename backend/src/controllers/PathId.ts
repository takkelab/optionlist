export interface PathIdParser {
  // パスの :id を読む。正の整数でないか、JS で正しく扱える整数（Number.MAX_SAFE_INTEGER まで）でなければ、その行は存在しないので null
  parse(value: unknown): number | null;
}

// options.id・suggestions.id は BIGINT。ID は Number.MAX_SAFE_INTEGER を超えないので、それより大きい ID の行は存在しない
const ID_MAX = Number.MAX_SAFE_INTEGER;

// パスの :id（api.md §3）。読めなければ、呼んだ側がその行の 404 にする
export class PathId implements PathIdParser {
  parse(value: unknown): number | null {
    const id = typeof value === "string" && /^[1-9]\d{0,15}$/.test(value) ? Number(value) : Number.NaN;
    return Number.isSafeInteger(id) && id <= ID_MAX ? id : null;
  }
}
