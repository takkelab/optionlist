import { useState } from 'react'
import type { CSSProperties, TouchEvent } from 'react'
import { SheetSwipe } from '../lib/SheetSwipe'
import type { SwipeState } from '../lib/SheetSwipe'

const swipe = new SheetSwipe()

// シートの中身（Sheet.module.css の body）に付けるタッチの扱い
export type SheetTouch = {
  onTouchStart: (event: TouchEvent<HTMLDivElement>) => void
  onTouchMove: (event: TouchEvent<HTMLDivElement>) => void
  onTouchEnd: (event: TouchEvent<HTMLDivElement>) => void
  onTouchCancel: () => void
}

export type SheetSwipeState = {
  // 開いた回数。閉じたあとも中身を残すので、開くたびに中身を作り直すための key に使う
  round: number
  // 引いている間のシートの位置（dialog の style）
  style: CSSProperties | undefined
  touch: SheetTouch
}

// 下からのシート（screens.md §3）を、どこからでも下へスワイプして閉じる。下へ引いている間はシートごと指に付いて下がる
// 閉じるときは引いた位置のまま残し、そこから下へ滑らせる（Sheet.module.css）。次に開くときに戻す
export function useSheetSwipe(open: boolean, onClose: () => void): SheetSwipeState {
  // null なら指を置いていない
  const [drag, setDrag] = useState<SwipeState | null>(null)
  const [wasOpen, setWasOpen] = useState(open)
  const [round, setRound] = useState(0)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setDrag(null)
      setRound(round + 1)
    }
  }
  // 重ねて開いた dialog（AI に相談・確認など）の中のタッチは、DOM の親のこのシートにも届くので引かない。
  // 持ち手から始めたときは、中身をスクロールしていても引く（持ち手はスクロールしない）
  const touchStart = (event: TouchEvent<HTMLDivElement>) => {
    const { touches, timeStamp, target, currentTarget } = event
    const touch = touches.item(0)
    if (touch === null || !(target instanceof Element) || target.closest('dialog') !== currentTarget.closest('dialog')) return
    const fromGrip = target.closest('[data-grip]') !== null
    setDrag(swipe.start({ x: touch.clientX, y: touch.clientY, at: timeStamp }, fromGrip))
  }
  // 中身のスクロールの位置を見て、引くかスクロールに任せるかを決める
  const touchMove = (event: TouchEvent<HTMLDivElement>) => {
    const { touches, timeStamp, currentTarget } = event
    const touch = touches.item(0)
    if (touch === null || drag === null) return
    const { scrollTop } = currentTarget
    setDrag(swipe.move(drag, { x: touch.clientX, y: touch.clientY, at: timeStamp }, scrollTop))
  }
  // 閉じないときは引いた量を消し、元の位置へ滑って戻す（Sheet.module.css の transition）
  const touchEnd = (event: TouchEvent<HTMLDivElement>) => {
    const { timeStamp } = event
    if (drag !== null && swipe.closes(drag, timeStamp)) onClose()
    else setDrag(null)
  }
  const pulling = drag !== null && drag.from !== null
  return {
    round,
    style: pulling ? { transform: `translateY(${drag.by}px)`, transition: 'none' } : undefined,
    touch: { onTouchStart: touchStart, onTouchMove: touchMove, onTouchEnd: touchEnd, onTouchCancel: () => setDrag(null) },
  }
}
