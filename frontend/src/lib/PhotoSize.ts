export type Size = { width: number; height: number }

export interface PhotoSizing {
  // 送る前に縮める大きさ。縦横比を保ち、長辺を上限に収める。小さい写真は大きくしない
  fit(size: Size): Size
}

// api.md §5 の長辺の上限
const LONG_SIDE_MAX = 1280

export class PhotoSize implements PhotoSizing {
  fit({ width, height }: Size): Size {
    const scale = Math.min(1, LONG_SIDE_MAX / Math.max(width, height))
    return { width: this.#pixels(width * scale), height: this.#pixels(height * scale) }
  }

  // 細長い写真でも 1px は残す（0 だと canvas に描けない）
  #pixels(value: number): number {
    return Math.max(1, Math.round(value))
  }
}
