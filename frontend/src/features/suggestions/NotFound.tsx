import { Link } from 'react-router'
import styles from './SuggestionPages.module.css'

// 存在しない提案・タグ（screens.md §5）。探す画面へのリンクを出す
export function NotFound({ message }: { message: string }) {
  return (
    <div className={styles.notFound}>
      <p>{message}</p>
      <Link to="/suggestions" className={styles.toExplore}>
        提案を探す
      </Link>
    </div>
  )
}
