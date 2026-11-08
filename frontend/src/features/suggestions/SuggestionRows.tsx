import type { SuggestionSummary } from '../../../../shared/types'
import { SuggestionLabels } from '../../lib/SuggestionLabels'
import styles from './SuggestionRows.module.css'
import { StackLink } from './StackLink'
import { ThemeColors } from './ThemeColors'

const labels = new SuggestionLabels()
const colors = new ThemeColors()

type Props = {
  suggestions: SuggestionSummary[]
  label?: string
}

// 提案の行の縦の並び。タグの一覧・テーマの一覧・関連で同じ形にする（screens.md §5。探す画面は SuggestionShelf の棚）
// 行は見出しと一歩の大きさ。上の辺にテーマの色の線。追加済みの提案も隠さず「追加済み」「やった」の印を付ける（隠すと関連のつながりが切れる）
export function SuggestionRows({ suggestions, label }: Props) {
  return (
    <ul className={styles.column} aria-label={label}>
      {suggestions.map((suggestion) => {
        const mark = labels.mark(suggestion.optionStatus)
        return (
          <li key={suggestion.id}>
            <StackLink
              to={`/suggestions/${suggestion.id}`}
              className={`${styles.row} ${colors.classOf(suggestion.themeId)}`}
              data-suggestion-hook
            >
              <span className={styles.hook}>{suggestion.hook}</span>
              <span className={styles.meta}>
                <span>{labels.size(suggestion.size)}</span>
                {mark !== null && (
                  <span className={styles.mark} data-suggestion-mark>
                    {mark}
                  </span>
                )}
              </span>
            </StackLink>
          </li>
        )
      })}
    </ul>
  )
}
