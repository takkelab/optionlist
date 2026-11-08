import type { SuggestionSize } from '../../../../shared/types'
import { SuggestionLabels } from '../../lib/SuggestionLabels'
import styles from './SizeChips.module.css'

const labels = new SuggestionLabels()

type Props = { selected: SuggestionSize | null; onChange: (size: SuggestionSize | null) => void }

// 一歩の大きさのチップ（screens.md §5）。1 つだけ選べ、選んだものをもう一度押すと外れる
export function SizeChips({ selected, onChange }: Props) {
  return (
    <div className={styles.chips} role="group" aria-label="一歩の大きさ">
      {labels.sizes().map((size) => {
        const pressed = size === selected
        return (
          <button
            key={size}
            type="button"
            className={pressed ? `${styles.chip} ${styles.pressed}` : styles.chip}
            aria-pressed={pressed}
            onClick={() => onChange(pressed ? null : size)}
          >
            {labels.size(size)}
          </button>
        )
      })}
    </div>
  )
}
