import { useCallback, useState } from 'react'
import { useAccountMemo, useNotifier } from '../../../app/hooks'
import type { ListActions } from '../../../lib/OptionListActions'
import { BrowserPhotoShrinker } from './BrowserPhotoShrinker'

const shrinker = new BrowserPhotoShrinker()

// 保存できたら true
export type SavePhoto = (achievementId: number, file: File) => Promise<boolean>

export type PhotoSave = {
  savePhoto: SavePhoto
  removePhoto: (achievementId: number) => Promise<void>
  // 保存・削除を待っている間は true。シートの写真の操作と 🎉 を押せないようにする（同じ達成への操作が重ならないように。screens.md §3）
  busy: boolean
}

// 選んだ写真を縮めて送る・消す（api.md §5）。読めない画像・失敗はトーストで知らせる。変えられたら onChanged
// optionId はシートに出している項目（まだ何も開いていなければ null で、呼ばれることはない）
export function usePhotoSave(optionId: number | null, actions: ListActions, onChanged: () => void): PhotoSave {
  const notifier = useNotifier()
  const memo = useAccountMemo()
  const [busy, setBusy] = useState(false)
  const savePhoto = useCallback<SavePhoto>(
    async (achievementId, file) => {
      if (optionId === null) return false
      setBusy(true)
      try {
        const photo = await shrinker.shrink(file).catch((error: unknown) => {
          notifier.error('この写真は読み込めませんでした。別の写真を選んでください', error)
          return null
        })
        if (photo === null) return false
        const saved = await actions.setPhoto(optionId, achievementId, photo)
        if (saved) {
          // 写真を初めて保存したら、復旧コードを控えるよう勧める（screens.md §9）
          memo.markPhotoSaved()
          onChanged()
        }
        return saved
      } finally {
        setBusy(false)
      }
    },
    [notifier, memo, optionId, actions, onChanged],
  )
  const removePhoto = useCallback(
    async (achievementId: number) => {
      if (optionId === null) return
      setBusy(true)
      try {
        if (await actions.removePhoto(optionId, achievementId)) onChanged()
      } finally {
        setBusy(false)
      }
    },
    [optionId, actions, onChanged],
  )
  return { savePhoto, removePhoto, busy }
}
