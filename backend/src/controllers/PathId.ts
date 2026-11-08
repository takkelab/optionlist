export interface PathIdParser {
  // パスの :id を読む。正の整数でないか、INT UNSIGNED に収まらなければ、その行は存在しないので null
  parse(value: unknown): number | null;
}

// options.id・suggestions.id は INT UNSIGNED。これを超える ID の行は存在しない（SQL に渡すと範囲外のエラーになる）
const ID_MAX = 4_294_967_295;

// パスの :id（api.md §3）。読めなければ、呼んだ側がその行の 404 にする
export class PathId implements PathIdParser {
  parse(value: unknown): number | null {
    const id = typeof value === "string" && /^[1-9]\d{0,9}$/.test(value) ? Number(value) : Number.NaN;
    return Number.isSafeInteger(id) && id <= ID_MAX ? id : null;
  }
}
