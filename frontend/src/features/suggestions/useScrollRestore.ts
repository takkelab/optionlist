import { useEffect, useLayoutEffect, useRef } from 'react'
import { useLocation, useNavigationType } from 'react-router'
import { useScrollMemory } from '../../app/hooks'

// 提案の画面のスクロール位置（screens.md §5 の「戻るで、たどってきた道を戻る」）
// - 進んで開いたら一番上から出す（関連から次の提案へ移ったときも）
// - 戻る・進むで開いたら、中身を描けた（ready）ところで離れたときの位置に戻す
// - 置き換え（一歩の大きさのチップ）では動かさない
export function useScrollRestore(ready: boolean): void {
  const memory = useScrollMemory()
  const { key } = useLocation()
  const navigationType = useNavigationType()
  // 位置を合わせ終えた履歴の項目
  const settled = useRef<string | null>(null)

  useLayoutEffect(() => {
    if (settled.current === key) return
    if (navigationType === 'PUSH') window.scrollTo(0, 0)
    else if (navigationType === 'POP') {
      if (!ready) return
      window.scrollTo(0, memory.restore(key) ?? 0)
    }
    settled.current = key
  }, [memory, key, navigationType, ready])

  // 離れるときの位置を、スクロールするたびに覚えておく（画面が入れ替わったあとでは、もう前の画面の位置を読めない）
  // 位置を戻す前のスクロール（中身がまだ短くて縮んだときなど）では、覚えている位置を上書きしない
  useEffect(() => {
    const save = () => {
      if (settled.current === key) memory.save(key, window.scrollY)
    }
    window.addEventListener('scroll', save, { passive: true })
    return () => window.removeEventListener('scroll', save)
  }, [memory, key])
}
