import { useLocation, useParams } from 'react-router'
import { PageHeader } from '../../components/PageHeader'
import { SuggestionBrowse } from '../../lib/SuggestionBrowse'
import { BackButton } from './BackButton'
import { NotFound } from './NotFound'
import styles from './SuggestionPages.module.css'
import { SuggestionRows } from './SuggestionRows'
import { useScrollRestore } from './useScrollRestore'
import { useSuggestionCatalog } from './useSuggestionCatalog'

const browse = new SuggestionBrowse()

// screens.md §5: タグの一覧（/suggestions/tags/:tagId）。見出しは「#星」のようにタグ名、提案は id 順
export function TagPage() {
  const { tagId } = useParams()
  const catalog = useSuggestionCatalog()
  const tagged = catalog === null ? null : browse.tagged(catalog, tagId)
  useScrollRestore(catalog !== null)
  // 描き終えた印（画面を滑らせるときに、これが出てから後の見た目を撮る。useStackSlide）
  const { key } = useLocation()
  const tag = tagged === null ? null : tagged.tag
  const title = tag === null ? 'タグ' : `#${tag.name}`

  return (
    <>
      <PageHeader title={title} start={<BackButton />} />
      {catalog !== null && tagged === null && <NotFound message="このタグは見つかりません" />}
      {tagged !== null && (
        <div className={styles.page} data-suggestion-page={key}>
          <SuggestionRows suggestions={tagged.suggestions} label={`${title} の提案`} />
        </div>
      )}
    </>
  )
}
