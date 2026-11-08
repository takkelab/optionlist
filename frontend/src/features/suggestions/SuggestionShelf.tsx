import type { SuggestionSummary } from '../../../../shared/types'
import { IconButton } from '../../components/IconButton'
import { SuggestionLabels } from '../../lib/SuggestionLabels'
import styles from './SuggestionShelf.module.css'
import { StackLink } from './StackLink'
import { ThemeColors } from './ThemeColors'
import { useShelfScroll } from './useShelfScroll'

const labels = new SuggestionLabels()
const colors = new ThemeColors()

type Props = {
  suggestions: SuggestionSummary[]
  // hero: 今月のおすすめの大きなカード / card: 今日すぐできる・テーマの棚の正方形に近いカード
  variant: 'hero' | 'card'
  label: string
}

// 探す画面の横スクロールの棚（screens.md §5）。次のカードの端が少し見え、止まる位置はカードの頭
// 追加済みの提案も隠さず「追加済み」「やった」の印を付ける（縦の行と同じ）
// マウスのある端末（PC）では、左右に ‹ › を重ねて出す。ホイールでは横に送れないため。まだ送れる側だけに出す
export function SuggestionShelf({ suggestions, variant, label }: Props) {
  const { ref, canPrev, canNext, prev, next } = useShelfScroll()
  return (
    <div className={styles.scroller}>
      <ul
        ref={ref}
        className={variant === 'hero' ? `${styles.shelf} ${styles.heroShelf}` : styles.shelf}
        aria-label={label}
      >
        {suggestions.map((suggestion) => (
          <li key={suggestion.id} className={styles.item}>
            {variant === 'hero' ? <HeroCard suggestion={suggestion} /> : <Card suggestion={suggestion} />}
          </li>
        ))}
      </ul>
      {canPrev && (
        <span className={`${styles.arrow} ${styles.arrowPrev}`}>
          <IconButton icon="back" label={`${label}の前へ`} onClick={prev} />
        </span>
      )}
      {canNext && (
        <span className={`${styles.arrow} ${styles.arrowNext}`}>
          <IconButton icon="next" label={`${label}の次へ`} onClick={next} />
        </span>
      )}
    </div>
  )
}

// 白地に虹の縁。上から季節の終わりの月と印、大きな見出し、タイトルと一歩の大きさ
function HeroCard({ suggestion }: { suggestion: SuggestionSummary }) {
  const until = labels.until(suggestion.seasonTo)
  const mark = labels.mark(suggestion.optionStatus)
  return (
    <StackLink to={`/suggestions/${suggestion.id}`} className={styles.hero} data-suggestion-hook>
      <span className={styles.badges}>
        {until !== null && <span className={styles.until}>{until}</span>}
        {mark !== null && (
          <span className={styles.until} data-suggestion-mark>
            {mark}
          </span>
        )}
      </span>
      <span className={styles.heroHook}>{suggestion.hook}</span>
      <span className={styles.heroMeta}>
        <span className={styles.heroTitle}>{suggestion.title}</span>
        <span>{labels.size(suggestion.size)}</span>
      </span>
    </StackLink>
  )
}

// 見出し（4 行まで）と、下に一歩の大きさと印。上の辺にテーマの色の線
function Card({ suggestion }: { suggestion: SuggestionSummary }) {
  const mark = labels.mark(suggestion.optionStatus)
  return (
    <StackLink
      to={`/suggestions/${suggestion.id}`}
      className={`${styles.card} ${colors.classOf(suggestion.themeId)}`}
      data-suggestion-hook
    >
      <span className={styles.cardHook}>{suggestion.hook}</span>
      <span className={styles.meta}>
        <span>{labels.size(suggestion.size)}</span>
        {mark !== null && (
          <span className={styles.mark} data-suggestion-mark>
            {mark}
          </span>
        )}
      </span>
    </StackLink>
  )
}
