import { Icon } from './Icon'
import type { IconName } from './Icon'
import styles from './IconButton.module.css'

// アイコンだけのボタン。タップ領域は 44×44px（metrics.md §3）。label は読み上げ用
// expanded を渡すと、開け閉めするボタンとして開いているかを読み上げに伝える（aria-expanded）
type Props = { icon: IconName; label: string; onClick: () => void; disabled?: boolean; expanded?: boolean }

export function IconButton({ icon, label, onClick, disabled = false, expanded }: Props) {
  return (
    <button
      type="button"
      className={styles.button}
      aria-label={label}
      aria-expanded={expanded}
      onClick={onClick}
      disabled={disabled}
    >
      <Icon name={icon} />
    </button>
  )
}
