import { Icon } from '../../../components/Icon'
import styles from './AddFab.module.css'

// screens.md §2: 追加の入口。片手で親指が届くよう、タブバーのすぐ上の右下に浮かせる
export function AddFab({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className={styles.fab} aria-label="やりたいことを追加" onClick={onClick}>
      <Icon name="plus" size={28} />
    </button>
  )
}
