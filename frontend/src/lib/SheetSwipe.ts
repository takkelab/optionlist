// 指の位置と時刻（ms）
export type TouchPoint = { x: number; y: number; at: number }

// 指を置いてからの状態。from が null の間はまだシートを引いていない（下へ動き出すのを待っている）。
// by は引いた量（px）、at は最後に動いた時刻、speed は最後に動いた速さ（px/ms、下向きが正）。
// fromGrip は持ち手から始めたか（持ち手は中身のスクロールの位置によらず引ける）
export type SwipeState = { x: number; y: number; from: number | null; by: number; at: number; speed: number; fromGrip: boolean }

export interface SwipeRule {
  start(point: TouchPoint, fromGrip: boolean): SwipeState
  // 指が動いたときの次の状態。null ならこのタッチではシートを引かない（中身のスクロールに任せる）
  move(state: SwipeState, point: TouchPoint, scrollTop: number): SwipeState | null
  // 指を離したときに閉じるか
  closes(state: SwipeState, releasedAt: number): boolean
}

// 下へこれだけ動いたら引き始める（押すだけの操作と分ける）
const START_PX = 8
// これより下へ引いて離すか、この速さより速く払って離したら閉じる
const CLOSE_PX = 80
const FLICK_PX_PER_MS = 0.5
// 最後に動いてからこれより長く止めて離したら、払ったとはみなさない（止まっている間は touchmove が来ない）
const FLICK_STOP_MS = 100

// 項目のシートを下へスワイプして閉じる判定（screens.md §3）。中身が一番上にあるときの、下向きの動きだけを引く動きにする
export class SheetSwipe implements SwipeRule {
  start(point: TouchPoint, fromGrip: boolean): SwipeState {
    return { x: point.x, y: point.y, from: null, by: 0, at: point.at, speed: 0, fromGrip }
  }

  move(state: SwipeState, point: TouchPoint, scrollTop: number): SwipeState | null {
    const dx = point.x - state.x
    const dy = point.y - state.y
    if (state.from === null) {
      if (Math.abs(dy) < START_PX && Math.abs(dx) < START_PX) return state
      // 横・上への動きや、中身を途中までスクロールしているとき（持ち手からでなければ）は引かない。
      // 一番上まで戻しても小数が残る端末があるので、1px までは一番上とみなす
      if (dy <= Math.abs(dx) || (scrollTop > 1 && !state.fromGrip)) return null
    }
    const from = state.from ?? state.y
    const by = Math.max(0, point.y - from)
    const speed = point.at > state.at ? (by - state.by) / (point.at - state.at) : state.speed
    return { ...state, from, by, at: point.at, speed }
  }

  closes(state: SwipeState, releasedAt: number): boolean {
    if (state.from === null) return false
    const flicked = releasedAt - state.at <= FLICK_STOP_MS && state.speed > FLICK_PX_PER_MS
    return state.by > CLOSE_PX || flicked
  }
}
