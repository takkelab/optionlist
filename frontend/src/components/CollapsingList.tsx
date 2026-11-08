import type { ReactNode } from 'react'
import { AnimatePresence, m, useReducedMotion } from 'motion/react'
import styles from './CollapsingList.module.css'

type Props<T> = {
  items: T[]
  className: string
  // ドラッグで並び替えている間は true。動くカードが切れないよう、縮むための切り取りを外す
  dragging?: boolean
  children: (item: T) => ReactNode
}

// やりたいリスト・やったリストの一覧。抜けたカード（やった・戻す・削除）は、シートが閉じるのを待ってから高さが縮みながら薄くなって消え、下のカードが詰まる（screens.md §1）
// 入ってくるカードには動きを付けない。視差効果を減らす設定ならすぐ消す
export function CollapsingList<T extends { id: number }>({ items, className, dragging = false, children }: Props<T>) {
  const reduced = useReducedMotion() ?? false
  const exit = reduced ? { duration: 0 } : { duration: 0.25, delay: 0.2, ease: 'easeIn' as const }
  return (
    // data-list-ready: 一覧は読み込みが終わってから描くので、切り替えの動き（lib/PageSlide.ts）はこの印が出るのを待ってから撮る
    <ul className={className} data-list-ready data-dragging={dragging || undefined}>
      <AnimatePresence initial={false}>
        {items.map((item) => (
          <m.li key={item.id} exit={{ height: 0, opacity: 0, transition: exit }} className={styles.item}>
            {children(item)}
          </m.li>
        ))}
      </AnimatePresence>
    </ul>
  )
}
