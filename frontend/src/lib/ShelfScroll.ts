export type ScrollBox = { scrollLeft: number; clientWidth: number; scrollWidth: number }
export type ShelfEdges = { canPrev: boolean; canNext: boolean }

export interface ShelfScroller {
  // 左右にまだ送れるか（端の側の矢印は押せなくする）
  edges(box: ScrollBox): ShelfEdges
  // 矢印 1 回で送る量（px）。見えている幅の 8 割で、少し重なりを残して次の範囲を見せる
  step(box: ScrollBox): number
}

// 小数の端数で「端まで来ていない」と判定しないための遊び（px）
const SLACK = 1
const STEP_RATIO = 0.8

// 探す画面の棚を、PC の矢印で横に送る（screens.md §5、docs/decisions/0024）
export class ShelfScroll implements ShelfScroller {
  edges({ scrollLeft, clientWidth, scrollWidth }: ScrollBox): ShelfEdges {
    return { canPrev: scrollLeft > SLACK, canNext: scrollLeft + clientWidth < scrollWidth - SLACK }
  }

  step({ clientWidth }: ScrollBox): number {
    return Math.round(clientWidth * STEP_RATIO)
  }
}
