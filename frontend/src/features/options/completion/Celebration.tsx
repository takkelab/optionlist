import { useEffect, useLayoutEffect, useRef } from 'react'
import { m, useReducedMotion } from 'motion/react'
import { ConfettiBurst } from '../../../lib/ConfettiBurst'
import styles from './Celebration.module.css'

const SHOW_MS = 1500
const PIECES = new ConfettiBurst().pieces(16)
const PIECE_CLASSES = [styles.dot, styles.dotStrong, styles.dotWarm, styles.spark]

type Props = {
  // 出す労いメッセージ。null なら出さない
  message: string | null
  // 出した回。同じ文言でも出し直すたびに動きを最初から流す
  round: number
  // 1.5 秒たったか、押して早送りしたとき
  onDone: () => void
}

// screens.md §4 の労いの演出。画面の中央に 🎉 とメッセージのカードがポンと出て、周りに紙吹雪が散る
// 項目のシート（モーダルの dialog）より上に出すため、トーストと同じく popover にして最前面に入れる。
// 画面全体を覆って、押したら早送りする（下のシートは押せない）
// 視差効果を減らす設定なら、動かさずに出して同じ時間で消す（紙吹雪は出さない）
export function Celebration({ message, round, onDone }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const reduced = useReducedMotion() ?? false
  useLayoutEffect(() => {
    const area = ref.current
    if (area === null) return
    if (area.matches(':popover-open')) area.hidePopover()
    if (message !== null) area.showPopover()
  }, [message, round])
  useEffect(() => {
    if (message === null) return undefined
    const timer = setTimeout(onDone, SHOW_MS)
    return () => clearTimeout(timer)
  }, [message, round, onDone])
  return (
    <div ref={ref} popover="manual" className={styles.area} role="status" aria-live="polite" onClick={onDone} data-celebration>
      {message !== null && (
        <div key={round} className={styles.center}>
          {!reduced &&
            PIECES.map((piece, index) => (
              <m.span
                key={index}
                className={PIECE_CLASSES[piece.kind]}
                aria-hidden="true"
                data-confetti
                initial={{ x: 0, y: 0, rotate: 0, opacity: 1, scale: 0.4 }}
                animate={{ x: piece.x, y: piece.y, rotate: piece.rotate, opacity: 0, scale: 1 }}
                transition={{ duration: 1.1, delay: piece.delay, ease: 'easeOut' }}
              />
            ))}
          <m.div
            className={styles.card}
            initial={reduced ? false : { scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 420, damping: 18 }}
          >
            <span className={styles.emoji} aria-hidden="true">
              🎉
            </span>
            <p className={styles.message}>{message}</p>
          </m.div>
        </div>
      )}
    </div>
  )
}
