import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

// 押してからシートを開くまで（弾みと粒を見せる。ユーザーがキャンバスで 0〜1.2 秒を比べて決めた）
const SHEET_DELAY_MS = 400
// 弾み・輪・粒が終わるまで
const BURST_MS = 700

export type AddCelebration = {
  // 弾み・粒を出している提案の id。なければ null
  celebratingId: number | null
  // 弾ませ始め、シートを開いてよくなったら resolve する。視差効果を減らす設定では動かさず、すぐ resolve する
  start(suggestionId: number): Promise<void>
  // 追加できなかったときに、すぐやめて元の形に戻す
  stop(): void
}

// [やりたいリストに追加] を押したときの弾みと粒（screens.md §5、docs/decisions/0027）。
// 応答を待たずに始め、追加できなかったら戻す。止めたとき・画面を離れたときも、待っている側は止めずに先へ進める
export function useAddCelebration(): AddCelebration {
  const [celebratingId, setCelebratingId] = useState<number | null>(null)
  const timers = useRef<number[]>([])
  const pending = useRef<(() => void) | null>(null)

  const clear = useCallback(() => {
    const { current } = timers
    current.forEach((timer) => clearTimeout(timer))
    timers.current = []
    const resolve = pending.current
    pending.current = null
    if (resolve !== null) resolve()
  }, [])
  useEffect(() => clear, [clear])

  const start = useCallback(
    (suggestionId: number) => {
      clear()
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
      if (reduced.matches) return Promise.resolve()
      setCelebratingId(suggestionId)
      return new Promise<void>((resolve) => {
        pending.current = resolve
        timers.current = [
          window.setTimeout(() => setCelebratingId(null), BURST_MS),
          window.setTimeout(() => {
            pending.current = null
            resolve()
          }, SHEET_DELAY_MS),
        ]
      })
    },
    [clear],
  )

  const stop = useCallback(() => {
    clear()
    setCelebratingId(null)
  }, [clear])
  return useMemo(() => ({ celebratingId, start, stop }), [celebratingId, start, stop])
}
