import { useSortable } from '@dnd-kit/sortable'
import type { Option } from '../../../../../shared/types'
import { Icon } from '../../../components/Icon'
import styles from '../OptionCard.module.css'
import { OptionCard } from './OptionCard'

type Props = { option: Option; onOpen: (option: Option) => void }

// 予定日がないカード。左端の取っ手を掴んだときだけドラッグになる（カードのタップはシートを開く。screens.md §2）
export function SortableCard({ option, onOpen }: Props) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: option.id })
  const handle = (
    <button type="button" ref={setActivatorNodeRef} className={styles.handle} aria-label={`${option.title}を並べ替える`} {...attributes} {...listeners}>
      <Icon name="grip" size={20} />
    </button>
  )
  return (
    <div
      ref={setNodeRef}
      className={styles.sortable}
      data-dragging={isDragging || undefined}
      style={{ transform: transform === null ? undefined : `translate3d(0, ${transform.y}px, 0)`, transition }}
    >
      <OptionCard option={option} onOpen={onOpen} handle={handle} />
    </div>
  )
}
