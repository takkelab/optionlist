import { useState } from 'react'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { usePhotoPicker } from '../photo/usePhotoPicker'
import type { SavePhoto } from '../photo/usePhotoSave'

type Props = {
  // 写真を聞く達成。null なら閉じている
  achievementId: number | null
  savePhoto: SavePhoto
  // 答えが済んだ（選んだ写真の保存が終わった・選ばなかった）
  onDone: () => void
}

// screens.md §4 の「写真を残しますか？」。やったリストの項目で 🎉 の演出のあとに出す（やりたいリストの項目は AchievedDialog）
export function PhotoPrompt({ achievementId, savePhoto, onDone }: Props) {
  // ファイルを選んでいる間は聞くダイアログを閉じておく
  const [picking, setPicking] = useState(false)
  const finish = () => {
    setPicking(false)
    onDone()
  }
  const picker = usePhotoPicker((file) => {
    if (achievementId !== null) void savePhoto(achievementId, file).finally(finish)
  }, finish)
  return (
    <>
      {picker.input}
      <ConfirmDialog
        open={achievementId !== null && !picking}
        message="写真を残しますか？"
        note="あとからシートで付けることもできます"
        confirmLabel="写真を選ぶ"
        cancelLabel="あとで"
        onConfirm={() => {
          setPicking(true)
          picker.open()
        }}
        onCancel={onDone}
      />
    </>
  )
}
