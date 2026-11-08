import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { ShelfScroll } from '../../lib/ShelfScroll'
import type { ShelfEdges } from '../../lib/ShelfScroll'

const shelf = new ShelfScroll()

type ShelfScrollState = ShelfEdges & {
  ref: RefObject<HTMLUListElement | null>
  prev: () => void
  next: () => void
}

// 棚の PC の矢印（screens.md §5）。スクロールと大きさの変化を見て、左右にまだ送れるかを持つ
export function useShelfScroll(): ShelfScrollState {
  const ref = useRef<HTMLUListElement>(null)
  const [edges, setEdges] = useState<ShelfEdges>({ canPrev: false, canNext: false })

  const update = useCallback(() => {
    const el = ref.current
    if (el !== null) setEdges(shelf.edges(el))
  }, [])

  useEffect(() => {
    const el = ref.current
    if (el === null) return
    update()
    el.addEventListener('scroll', update, { passive: true })
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => {
      el.removeEventListener('scroll', update)
      observer.disconnect()
    }
  }, [update])

  const by = (direction: 1 | -1) => {
    const el = ref.current
    if (el === null) return
    // 視差効果を減らす設定なら、滑らせずにすぐ送る（screens.md §1）
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const reduced = query.matches
    el.scrollBy({ left: direction * shelf.step(el), behavior: reduced ? 'auto' : 'smooth' })
  }

  return { ref, ...edges, prev: () => by(-1), next: () => by(1) }
}
