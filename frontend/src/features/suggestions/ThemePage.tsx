import { useLocation, useParams } from 'react-router'
import { PageHeader } from '../../components/PageHeader'
import { SuggestionBrowse } from '../../lib/SuggestionBrowse'
import { BackButton } from './BackButton'
import { NotFound } from './NotFound'
import styles from './SuggestionPages.module.css'
import { SuggestionRows } from './SuggestionRows'
import { ThemeColors } from './ThemeColors'
import { useScrollRestore } from './useScrollRestore'
import { useSuggestionCatalog } from './useSuggestionCatalog'

const browse = new SuggestionBrowse()
const colors = new ThemeColors()

// screens.md §5: テーマの一覧（/suggestions/themes/:themeId）。見出しはテーマ名、上に件数、提案は id 順にすべて
export function ThemePage() {
  const { themeId } = useParams()
  const catalog = useSuggestionCatalog()
  const themed = catalog === null ? null : browse.themed(catalog, themeId)
  useScrollRestore(catalog !== null)
  // 描き終えた印（画面を滑らせるときに、これが出てから後の見た目を撮る。useStackSlide）
  const { key } = useLocation()
  const theme = themed === null ? null : themed.theme
  const title = theme === null ? 'テーマ' : theme.name
  const suggestions = themed === null ? [] : themed.suggestions
  const colorClass = theme === null ? '' : colors.classOf(theme.id)

  return (
    <>
      <PageHeader title={title} start={<BackButton />} />
      {catalog !== null && themed === null && <NotFound message="このテーマは見つかりません" />}
      {themed !== null && (
        <div className={styles.page} data-suggestion-page={key}>
          <section className={`${styles.section} ${colorClass}`}>
            <p className={`${styles.count} ${styles.themeHeading}`}>
              <span className={colors.dot()} aria-hidden="true" />
              {suggestions.length} 件
            </p>
            <SuggestionRows suggestions={suggestions} label={`${title} の提案`} />
          </section>
        </div>
      )}
    </>
  )
}
