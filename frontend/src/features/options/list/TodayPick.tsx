import { useState } from 'react'
import type { Option } from '../../../../../shared/types'
import { IconButton } from '../../../components/IconButton'
import { RandomPick } from '../../../lib/RandomPick'
import styles from './TodayPick.module.css'

const picker = new RandomPick()

// screens.md §2: 一覧の一番上に、自分のリストから 1 件をランダムに出す。ふと見たときに「やってみようかな」と思えるように
// 選ぶのは画面を開いたときと「ほかのを見る」を押したときだけ（追加しても選び直さない）
export function TodayPick({ options, onOpen }: { options: Option[]; onOpen: (option: Option) => void }) {
  const [pickedId, setPickedId] = useState(() => {
    const first = picker.pick(options)
    return first === null ? null : first.id
  })
  const current = options.find((o) => o.id === pickedId) ?? options[0]
  if (current === undefined) return null

  const again = () => {
    const next = picker.pick(options, current)
    if (next !== null) setPickedId(next.id)
  }

  return (
    <section className={styles.pick} aria-label="今日はこれどう？">
      <button type="button" className={styles.open} onClick={() => onOpen(current)}>
        <span className={styles.label}>今日はこれどう？</span>
        <span className={styles.title} data-today-pick>
          {current.title}
        </span>
      </button>
      <IconButton icon="shuffle" label="ほかのを見る" onClick={again} />
    </section>
  )
}
