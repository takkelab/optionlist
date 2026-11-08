import { useLayoutEffect, useRef } from 'react'
import type { RefObject, SyntheticEvent } from 'react'

export type ModalProps = { ref: RefObject<HTMLDialogElement | null>; onCancel: (event: SyntheticEvent) => void }

// open に合わせて <dialog> をモーダルで開け閉めする。返す値をそのまま <dialog> に渡す
// Esc で閉じようとしたときは onDismiss で知らせ、閉じるのは open を変えてもらって行う。
// 開くのは描画の直後（useLayoutEffect）。中身の useEffect が、表示された後で動くように。
// 開いたら data-autofocus の付いた要素にフォーカスする（なければブラウザの決まりどおり最初の入力欄など。React の autoFocus は閉じた dialog の中では効かない）
// 閉じるときは data-closing を付けて消える動き（screens.md §1）を CSS で流し、終わってから close() する。
// 動きがなければ（視差効果を減らす設定など）すぐ閉じる。閉じる途中で開き直したら、閉じるのをやめる。
// 閉じる途中は inert にして、消えていくボタンをもう一度押せないようにする（追加・削除が 2 回送られないように）。
// 中に終わらない動き（infinite）を入れると閉じなくなるので、入れるときは待つ対象から外す
// dialog の close イベントは使わない（閉じたあとに遅れて届くので、続けて別のダイアログを開いたときにその状態まで消してしまう）
export function useModal(open: boolean, onDismiss: () => void): ModalProps {
  const ref = useRef<HTMLDialogElement>(null)
  useLayoutEffect(() => {
    const dialog = ref.current
    if (dialog === null) return undefined
    const { dataset } = dialog
    if (open) {
      delete dataset.closing
      dialog.inert = false
      if (!dialog.open) {
        // 開いたときのフォーカス先を中身が決める（例: AI に相談はキーボードを出さないよう [コピー] に置く）。
        // showModal の前に autofocus 属性を付け、最初の入力欄に一瞬でもフォーカスが当たらないようにする。
        // 中に重ねた dialog（閉じている相談のダイアログなど）の要素は除く
        const marked = [...dialog.querySelectorAll<HTMLElement>('[data-autofocus]')]
        const [first] = marked.filter((element) => element.closest('dialog') === dialog)
        first?.setAttribute('autofocus', '')
        dialog.showModal()
      }
      return undefined
    }
    if (!dialog.open) return undefined
    let cancelled = false
    dataset.closing = ''
    dialog.inert = true
    // getAnimations は付けたばかりの data-closing をスタイルに反映してから返す（::backdrop は本体と同じ長さなので本体を待てば足りる）
    const running = dialog.getAnimations({ subtree: true }).map((animation) => animation.finished)
    void Promise.allSettled(running).then(() => {
      if (cancelled) return
      delete dataset.closing
      dialog.inert = false
      dialog.close()
    })
    return () => {
      cancelled = true
    }
  }, [open])
  // 重ねて開いた dialog（項目のシートの上の相談のダイアログなど）の Esc は、React が親の dialog にも伝えるので止める
  const onCancel = (event: SyntheticEvent) => {
    event.preventDefault()
    event.stopPropagation()
    onDismiss()
  }
  return { ref, onCancel }
}
