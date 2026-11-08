import { useEffect, useState } from 'react'
import { ScrollVisibility } from '../lib/ScrollVisibility'

// ヘッダーを出しておくか。下にスクロールし始めたら false、上に戻し始めたら true（screens.md §1）
// 一番上から 64px（ヘッダーの高さ）までは常に出す。8px 未満の動きは無視する
export function useHeaderVisible(): boolean {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const tracker = new ScrollVisibility(64, 8)
    const onScroll = () => setVisible(tracker.update(window.scrollY))
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return visible
}
