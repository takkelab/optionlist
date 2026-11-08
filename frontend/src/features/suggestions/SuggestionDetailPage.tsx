import { useLocation, useParams } from 'react-router'
import type { SuggestionDetail, Theme } from '../../../../shared/types'
import { useCatalogLoader } from '../../app/hooks'
import { PageHeader } from '../../components/PageHeader'
import { SuggestionLabels } from '../../lib/SuggestionLabels'
import { OptionSheet } from '../options/OptionSheet'
import { AddButton } from './AddButton'
import { BackButton } from './BackButton'
import { NotFound } from './NotFound'
import { StackLink } from './StackLink'
import styles from './SuggestionPages.module.css'
import { SuggestionRows } from './SuggestionRows'
import { ThemeColors } from './ThemeColors'
import { useScrollRestore } from './useScrollRestore'
import { useSuggestionDetail } from './useSuggestionDetail'
import { useSuggestionSheet } from './useSuggestionSheet'
import type { SuggestionSheet } from './useSuggestionSheet'

const labels = new SuggestionLabels()
const colors = new ThemeColors()

// screens.md §5: 提案 1 件（/suggestions/:id）。見出しと豆知識のカード・最初の一歩・タグ・関連と、下に固定した追加ボタン。
// 追加したら、その場で項目のシート（提案から開く形）を開く（docs/decisions/0025）
export function SuggestionDetailPage() {
  const { id } = useParams()
  const view = useSuggestionDetail(id)
  const { detail } = view
  const sheet = useSuggestionSheet(view)
  // テーマ名は探す画面で読んだ一覧から引く（URL を直接開いて一覧がまだなければ、テーマ名は出さない）
  const catalog = useCatalogLoader().cached()
  const themes = catalog === null ? [] : catalog.themes
  useScrollRestore(detail !== undefined)

  return (
    <>
      <PageHeader title="提案" start={<BackButton />} />
      {detail === null && <NotFound message="この提案は見つかりません" />}
      {detail !== undefined && detail !== null && (
        <DetailBody detail={detail} theme={themes.find((theme) => theme.id === detail.themeId) ?? null} sheet={sheet} />
      )}
      <OptionSheet
        option={sheet.opened}
        onClose={sheet.close}
        actions={sheet.actions}
        origin={sheet.origin}
        firstStep={detail?.firstStep ?? null}
      />
    </>
  )
}

type BodyProps = { detail: SuggestionDetail; theme: Theme | null; sheet: SuggestionSheet }

function DetailBody({ detail, theme, sheet }: BodyProps) {
  const { tags, related, optionStatus } = detail
  const season = labels.season(detail.seasonFrom, detail.seasonTo)
  const press = () => void (optionStatus === null ? sheet.add(detail) : sheet.reopen(detail))
  // 描き終えた印（画面を滑らせるときに、これが出てから後の見た目を撮る。useStackSlide）
  const { key } = useLocation()
  return (
    <>
      <article className={styles.detail} data-suggestion-page={key}>
        {/* 見出し（引き）と豆知識（その答え）を 1 枚のカードにまとめ、最初の一歩（やること）と分ける */}
        <div className={`${styles.card} ${colors.classOf(detail.themeId)}`}>
          {theme !== null && (
            <StackLink to={`/suggestions/themes/${theme.id}`} className={styles.theme}>
              <span className={colors.dot()} aria-hidden="true" />
              {theme.name}
            </StackLink>
          )}
          <h2 className={styles.hook}>{detail.hook}</h2>
          <p className={styles.facts}>
            <span className={styles.fact}>{labels.size(detail.size)}</span>
            {season !== null && <span className={styles.fact}>{season}</span>}
          </p>
          <section className={styles.trivia}>
            <h3 className={styles.blockHeading}>豆知識</h3>
            <p>{detail.trivia}</p>
          </section>
        </div>
        <section className={styles.block}>
          <h3 className={styles.blockHeading}>最初の一歩</h3>
          <p className={styles.firstStep}>{detail.firstStep}</p>
        </section>
        <ul className={styles.tags} aria-label="タグ">
          {tags.map((tag) => (
            <li key={tag.id}>
              <StackLink to={`/suggestions/tags/${tag.id}`} className={styles.tag}>
                #{tag.name}
              </StackLink>
            </li>
          ))}
        </ul>
        {related.length > 0 && (
          <section className={styles.related}>
            <h3 className={styles.heading}>関連</h3>
            <SuggestionRows suggestions={related} label="関連" />
          </section>
        )}
      </article>
      {/* 画面の下（タブバーの上）に固定する。409 のあとの読み直しを待つ間（id がまだない）は押せない */}
      <AddButton
        status={optionStatus}
        celebrating={sheet.celebrating}
        onPress={press}
        disabled={sheet.busy || (optionStatus !== null && detail.optionId === null)}
      />
    </>
  )
}
