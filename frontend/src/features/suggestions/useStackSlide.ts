import type { MouseEvent } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { DocumentTransitionHost, PageSlide } from '../../lib/PageSlide'

const pageSlide = new PageSlide(new DocumentTransitionHost())

export type StackSlide = {
  // 提案の画面へのリンクを押したとき。次の画面が右から入る
  forward(event: MouseEvent<HTMLAnchorElement>, to: string): void
  // ヘッダーの［‹］。前の画面が左から戻る
  back(): void
}

// screens.md §5: 提案の画面（探す → 提案 → 関連 …）を進む・戻るときに、画面を横に滑らせる（docs/decisions/0026。動きは global.css）
// - 滑らせるのはアプリのリンクと［‹］だけ。ブラウザの戻る（iPhone の端からのスワイプ・Android の戻る）では、
//   ブラウザ自身が動かすことがあり、重ねると二重に動いて見えるので動かさない
// - 中身を描き終えた画面には data-suggestion-page（値は履歴の項目の key）を付ける。今の画面と違う key の印が出てから、後の見た目を撮る
// - View Transitions がないブラウザと、視差効果を減らす設定では、今までどおりすぐ切り替える
export function useStackSlide(): StackSlide {
  const navigate = useNavigate()
  const { key } = useLocation()
  const next = `[data-suggestion-page]:not([data-suggestion-page="${key}"])`
  return {
    forward: (event, to) => {
      // 新しいタブで開くなどの修飾キー付きのクリックは、Link に任せる
      const { button, metaKey, ctrlKey, shiftKey, altKey } = event
      if (button !== 0 || metaKey || ctrlKey || shiftKey || altKey) return
      if (pageSlide.slide('forward', () => void navigate(to), next)) event.preventDefault()
    },
    back: () => {
      // URL を直接開いた（履歴の最初の項目。key が 'default'）ときは戻る先がアプリにないので、探す画面へ置き換える
      const go = () => void (key === 'default' ? navigate('/suggestions', { replace: true }) : navigate(-1))
      if (!pageSlide.slide('back', go, next)) go()
    },
  }
}
