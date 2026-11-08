import { useCallback, useEffect, useRef } from 'react'
import type { ChangeEvent, ReactNode } from 'react'

export type PhotoPicker = {
  // 隠した input。これを描画しておく
  input: ReactNode
  // ファイルの選択を開く。押した操作の中で呼ぶ（ブラウザの決まり）
  open: () => void
}

// 写真を選ぶ。選んだら onPicked、選ばずに閉じたら onCancel
export function usePhotoPicker(onPicked: (file: File) => void, onCancel?: () => void): PhotoPicker {
  const element = useRef<HTMLInputElement | null>(null)
  const cancelled = useRef(onCancel)
  useEffect(() => {
    cancelled.current = onCancel
  }, [onCancel])

  // input の cancel は親へ伝わるので、シートの dialog が Esc と取り違えて閉じないよう、ここで止める。
  // React の onCancel は親の dialog に付くリスナーから呼ばれて止めるのが遅いので、直接付ける。
  // 使う側が input をあとから描くこともあるので（読み込みの間は描かないなど）、描かれたときに付ける
  const attach = useCallback((input: HTMLInputElement | null) => {
    element.current = input
    if (input === null) return undefined
    const stop = (event: Event) => {
      event.stopPropagation()
      cancelled.current?.()
    }
    input.addEventListener('cancel', stop)
    return () => input.removeEventListener('cancel', stop)
  }, [])

  const change = (event: ChangeEvent<HTMLInputElement>) => {
    const { target } = event
    const { files } = target
    const file = files?.item(0) ?? null
    // 同じ写真を選び直しても change が届くように空にする
    target.value = ''
    if (file !== null) onPicked(file)
  }
  const open = () => {
    const { current } = element
    current?.click()
  }
  return { input: <input ref={attach} type="file" accept="image/*" hidden aria-label="写真を選ぶ" onChange={change} />, open }
}
