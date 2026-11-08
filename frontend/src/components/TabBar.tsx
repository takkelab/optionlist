import { Link, useLocation } from 'react-router'
import { Icon } from './Icon'
import type { IconName } from './Icon'
import styles from './TabBar.module.css'

// paths: そのタブを選んでいる扱いにするルート。その下のルートも含む（提案 1 件・タグの一覧は「提案」の中。やったリストは「やりたい」の中の切り替えで見る）
const TABS: { to: string; label: string; icon: IconName; paths: string[] }[] = [
  { to: '/', label: 'やりたい', icon: 'list', paths: ['/', '/done'] },
  { to: '/suggestions', label: '提案', icon: 'sparkle', paths: ['/suggestions'] },
]

// screens.md §1: 下部のタブバー（やりたい / 提案）
// やったリストでは「やりたい」タブも選んだ表示にするが、リンク先（/）は今のページではないので、そのときだけ aria-current を page ではなく true にする
export function TabBar() {
  const { pathname } = useLocation()
  return (
    <nav className={styles.bar} aria-label="画面の切り替え">
      {TABS.map(({ to, label, icon, paths }) => {
        const active = paths.some((path) => pathname === path || pathname.startsWith(`${path}/`))
        return (
          <Link
            key={to}
            to={to}
            aria-current={active ? (pathname === to ? 'page' : 'true') : undefined}
            className={active ? `${styles.tab} ${styles.active}` : styles.tab}
          >
            <Icon name={icon} />
            <span className={styles.label}>{label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
