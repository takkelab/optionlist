import { useState } from 'react'
import { useLocation, useSearchParams } from 'react-router'
import type { SuggestionSize } from '../../../../shared/types'
import { IconButton } from '../../components/IconButton'
import { PageHeader } from '../../components/PageHeader'
import { SuggestionBrowse } from '../../lib/SuggestionBrowse'
import { SuggestionLabels } from '../../lib/SuggestionLabels'
import { SizeChips } from './SizeChips'
import { StackLink } from './StackLink'
import styles from './SuggestionPages.module.css'
import { SuggestionShelf } from './SuggestionShelf'
import { ThemeColors } from './ThemeColors'
import { useScrollRestore } from './useScrollRestore'
import { useSuggestionCatalog } from './useSuggestionCatalog'

const browse = new SuggestionBrowse()
const sizes = new SuggestionLabels().sizes()
const colors = new ThemeColors()

// screens.md §5: 探す画面（/suggestions）。今月のおすすめの大きなカード → 今日すぐできる → テーマの棚（テーマ名の右に、テーマの一覧へのリンク）
// 一歩の大きさのチップはヘッダーの「絞り込み」で出し入れする
// 選んだチップは URL（?size=）に置き換えで入れる。提案を開いて戻ってきたとき、同じ絞り込みとスクロール位置で出すため
export function SuggestionsPage() {
  const catalog = useSuggestionCatalog()
  const [params, setParams] = useSearchParams()
  const sizeParam = params.get('size')
  const size = sizes.find((s) => s === sizeParam) ?? null
  // 今月（端末の日付）。描画のたびに時刻を読まないよう、最初に 1 回だけ読む
  const [month] = useState(() => new Date().getMonth() + 1)
  // 選んだ状態で開き直したときは、チップを出しておく
  const [filterOpen, setFilterOpen] = useState(size !== null)
  useScrollRestore(catalog !== null)
  // 描き終えた印（［‹］で戻ってきたときに、これが出てから後の見た目を撮る。useStackSlide）
  const { key } = useLocation()

  const select = (next: SuggestionSize | null) => setParams(next === null ? {} : { size: next }, { replace: true })
  // 選んだまましまうと絞り込みも外す
  const toggleFilter = () => {
    if (filterOpen && size !== null) select(null)
    setFilterOpen(!filterOpen)
  }
  const picks = catalog === null ? [] : browse.monthPicks(catalog, month, size)
  const quick = catalog === null || size !== null ? [] : browse.quickPicks(catalog, month)
  const groups = catalog === null ? [] : browse.themeGroups(catalog, month, size)
  const monthTitle = `${month} 月のおすすめ`

  return (
    <>
      <PageHeader
        title="提案"
        end={<IconButton icon="filter" label="絞り込み" onClick={toggleFilter} expanded={filterOpen} />}
      />
      {catalog !== null && (
        <div className={styles.explore} data-suggestion-page={key}>
          {filterOpen && <SizeChips selected={size} onChange={select} />}
          {picks.length > 0 && (
            <section className={styles.section}>
              <h2 className={styles.shelfHeading}>{monthTitle}</h2>
              <SuggestionShelf suggestions={picks} variant="hero" label={monthTitle} />
            </section>
          )}
          {quick.length > 0 && (
            <section className={styles.section}>
              <div className={styles.headingBlock}>
                <h2 className={styles.shelfHeading}>今日すぐできる</h2>
                <p className={styles.subheading}>1 時間以内で終わること</p>
              </div>
              <SuggestionShelf suggestions={quick} variant="card" label="今日すぐできる" />
            </section>
          )}
          {groups.map(({ theme, suggestions, total }) => (
            <section key={theme.id} className={`${styles.section} ${colors.classOf(theme.id)}`}>
              <div className={styles.headingRow}>
                <h2 className={`${styles.shelfHeading} ${styles.themeHeading}`}>
                  <span className={colors.dot()} aria-hidden="true" />
                  {theme.name}
                </h2>
                <StackLink
                  to={`/suggestions/themes/${theme.id}`}
                  className={styles.seeAll}
                  aria-label={`${theme.name} すべて ${total} 件`}
                >
                  すべて {total} 件
                </StackLink>
              </div>
              <SuggestionShelf suggestions={suggestions} variant="card" label={theme.name} />
            </section>
          ))}
        </div>
      )}
    </>
  )
}
