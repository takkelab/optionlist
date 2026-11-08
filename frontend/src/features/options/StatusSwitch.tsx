import type { MouseEvent } from 'react'
import { flushSync } from 'react-dom'
import { NavLink, useLocation, useNavigate } from 'react-router'
import { useListLoader } from '../../app/hooks'
import { DocumentTransitionHost, PageSlide } from '../../lib/PageSlide'
import styles from './StatusSwitch.module.css'

const SEGMENTS = [
  { to: '/', label: 'やりたいこと', side: 'wish', status: 'pending' },
  { to: '/done', label: 'やったこと', side: 'done', status: 'completed' },
] as const
const pageSlide = new PageSlide(new DocumentTransitionHost())
// 読み込みが終わった一覧（CollapsingList）に付く印。切り替えた後の見た目は、これが出てから撮る
const LIST_READY = '[data-list-ready]'

// screens.md §1: やりたいリストとやったリストの切り替え。ヘッダーの真ん中に見出しの代わりに置く。見る向きを変えるだけなので、履歴は積まない（戻るでは前の画面に戻る）
// 押したら一覧が左右に滑って入れ替わり、選んでいる側の印も滑って移る（docs/decisions/0019。動きは global.css）。
// View Transitions がないブラウザと、視差効果を減らす設定では、今までどおりすぐ切り替える
export function StatusSwitch() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const loader = useListLoader()
  const slide = (event: MouseEvent<HTMLAnchorElement>, to: string, side: string) => {
    // 今いる側と、新しいタブで開くなどの修飾キー付きのクリックは、NavLink に任せる
    const { button, metaKey, ctrlKey, shiftKey, altKey } = event
    if (to === pathname || button !== 0 || metaKey || ctrlKey || shiftKey || altKey) return
    // React の描画をすぐ終わらせ、切り替えた後の見た目を撮れるようにする
    if (pageSlide.slide(side, () => flushSync(() => navigate(to, { replace: true })), LIST_READY)) event.preventDefault()
  }
  return (
    <nav className={styles.switch} aria-label="やりたい・やったの切り替え">
      {/* 選んでいる側の白い印。どちらの画面でも文字より前に 1 つだけ置き、選んでいる側へ CSS で寄せる。
          切り替えたときに前の位置から滑って移り、文字（それぞれ別に撮る）の下を通る（global.css） */}
      <span className={pathname === '/done' ? `${styles.pill} ${styles.pillDone}` : styles.pill} aria-hidden="true" />
      {SEGMENTS.map((segment) => (
        <NavLink
          key={segment.to}
          to={segment.to}
          end
          replace
          // 指が触れた瞬間（離す前）に切り替えた先の一覧を読み始め、押してから動き出すまでの待ちを減らす（lib/ListPrefetch.ts）
          onPointerDown={() => {
            if (segment.to !== pathname) loader.prefetch(segment.status)
          }}
          onClick={(event) => slide(event, segment.to, segment.side)}
          className={({ isActive }) => (isActive ? `${styles.segment} ${styles.active}` : styles.segment)}
        >
          {/* 文字も別に撮り、滑る白い印の上に重ねる（ヘッダーの絵に入れたままだと、印に隠れる。global.css） */}
          <span style={{ viewTransitionName: `switch-label-${segment.side}` }}>{segment.label}</span>
        </NavLink>
      ))}
    </nav>
  )
}
