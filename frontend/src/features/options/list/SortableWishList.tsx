import { useEffect, useMemo, useRef, useState } from 'react'
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import type { Announcements, DragEndEvent, Modifier, UniqueIdentifier } from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable'
import type { Option } from '../../../../../shared/types'
import { CollapsingList } from '../../../components/CollapsingList'
import styles from '../OptionList.module.css'
import { OptionCard } from './OptionCard'
import { SortableCard } from './SortableCard'

type Props = {
  options: Option[]
  // 読み込みが届くまでは true（最近読んだ一覧は、届いた一覧で置き換わるので動かさせない）
  disabled: boolean
  onOpen: (option: Option) => void
  onReorder: (activeId: number, overId: number) => void
}

// dnd-kit が置いたカードを滑らせる時間（250ms）より少し長く
const SETTLE_MS = 300

const INSTRUCTIONS = { draggable: 'スペースキーで持ち上げ、上下の矢印キーで動かし、もう一度スペースキーで置きます。Esc でやめます。' }

// やりたいリストの一覧。予定日がないカードだけを、左端の取っ手でドラッグして並べ替える（screens.md §2）
// 予定日があるカードは日付の順で決まるので、並べ替えの対象（SortableContext）に入れない
export function SortableWishList({ options, disabled, onOpen, onReorder }: Props) {
  const [dragging, setDragging] = useState(false)
  // 置いたカードが新しい位置へ滑り終わるまでは、カードの切り取りを戻さない
  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(settle.current), [])
  const start = () => {
    clearTimeout(settle.current)
    setDragging(true)
  }
  const stop = () => {
    settle.current = setTimeout(() => setDragging(false), SETTLE_MS)
  }
  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  const undated = useMemo(() => options.filter((option) => option.plannedOn === null).map((option) => option.id), [options])
  // 縦の一覧なので、横には動かさない
  const modifiers = useMemo<Modifier[]>(() => [({ transform }) => ({ ...transform, x: 0 })], [])
  const announcements = useMemo<Announcements>(() => {
    const title = (id: UniqueIdentifier) => {
      const found = options.find((option) => option.id === id)
      return found?.title ?? ''
    }
    return {
      onDragStart: ({ active }) => `「${title(active.id)}」を持ち上げました`,
      onDragOver: ({ active, over }) => (over ? `「${title(active.id)}」を「${title(over.id)}」の位置へ動かしています` : undefined),
      onDragEnd: ({ active, over }) => (over ? `「${title(active.id)}」を「${title(over.id)}」の位置に置きました` : undefined),
      onDragCancel: ({ active }) => `「${title(active.id)}」の並べ替えをやめました`,
    }
  }, [options])

  const end = ({ active, over }: DragEndEvent) => {
    stop()
    if (over !== null) onReorder(Number(active.id), Number(over.id))
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={modifiers}
      accessibility={{ announcements, screenReaderInstructions: INSTRUCTIONS }}
      onDragStart={start}
      onDragEnd={end}
      onDragCancel={stop}
    >
      <SortableContext items={undated} strategy={verticalListSortingStrategy} disabled={disabled}>
        {/* 最後の 1 枚が抜けるときも縮んで消えるよう、空になっても一覧は描いておく */}
        <CollapsingList items={options} className={styles.list} dragging={dragging}>
          {(option) =>
            option.plannedOn === null ? <SortableCard option={option} onOpen={onOpen} /> : <OptionCard option={option} onOpen={onOpen} />
          }
        </CollapsingList>
      </SortableContext>
    </DndContext>
  )
}
