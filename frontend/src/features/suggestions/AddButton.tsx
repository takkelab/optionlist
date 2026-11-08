import type { CSSProperties } from 'react'
import type { OptionStatus } from '../../../../shared/types'
import styles from './AddButton.module.css'

const HEART =
  'M12 21s-6.7-4.35-9.33-8.36C.68 9.9 1.9 6 5.5 5.1c2.1-.5 4.1.4 5.3 2.1L12 8.6l1.2-1.4c1.2-1.7 3.2-2.6 5.3-2.1 3.6.9 4.8 4.8 2.83 7.54C18.7 16.65 12 21 12 21z'
// 追加済み・やったのときの文字。押すと項目のシートを開き直す（screens.md §5）
const ADDED_LABEL = { pending: 'やりたいリストにあります', completed: 'やったリストにあります' } as const
// はじける粒。10 個を等間隔に並べ、1 つおきに少し遠くまで飛ばす（色は CSS で順番に付ける）
const PARTICLES = Array.from({ length: 10 }, (_, i) => {
  const angle = (i / 10) * Math.PI * 2 - Math.PI / 2
  const distance = 30 + (i % 2) * 8
  const style = {
    '--dx': `${Math.round(Math.cos(angle) * distance)}px`,
    '--dy': `${Math.round(Math.sin(angle) * distance)}px`,
  }
  return style as CSSProperties
})

type Props = {
  // 項目の状態。追加していなければ null
  status: OptionStatus | null
  // 押した直後の弾み・粒を出している間は true（応答を待たずに塗った形にする）
  celebrating: boolean
  disabled: boolean
  onPress(): void
}

// 提案 1 件の画面の下に固定した追加ボタン（screens.md §5、docs/decisions/0027）
export function AddButton({ status, celebrating, disabled, onPress }: Props) {
  // 追加していないのに押せないのは、応答を待っている間（弾みが終わっても応答が遅ければ塗ったままにする）
  const added = status !== null || celebrating || disabled
  return (
    <button
      type="button"
      className={added ? `${styles.add} ${styles.added}` : styles.add}
      onClick={onPress}
      disabled={disabled}
      data-suggestion-add
    >
      <span className={styles.heart} aria-hidden="true">
        <svg className={celebrating ? styles.pop : undefined} width="24" height="24" viewBox="0 0 24 24" fill={added ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={2} strokeLinejoin="round">
          <path d={HEART} />
        </svg>
        {celebrating && <span className={styles.ring} />}
        {celebrating && (
          <span className={styles.burst}>
            {PARTICLES.map((style, i) => (
              <span key={i} className={styles.particle} style={style} />
            ))}
          </span>
        )}
      </span>
      {added ? ADDED_LABEL[status ?? 'pending'] : 'やりたいリストに追加'}
    </button>
  )
}
