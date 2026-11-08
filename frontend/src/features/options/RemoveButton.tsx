import { useState } from 'react'
import type { Option } from '../../../../shared/types'
import { useNotifier } from '../../app/hooks'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import type { ListActions } from '../../lib/OptionListActions'
import styles from './OptionSheet.module.css'

type Props = { option: Option; actions: ListActions; onClose: () => void }

// 項目のシートの一番下の「🗑 この項目を削除」（screens.md §3）。確かめてから消し、シートを閉じてトーストで知らせる
export function RemoveButton({ option, actions, onClose }: Props) {
  const notifier = useNotifier()
  const [confirming, setConfirming] = useState(false)
  const { id, title } = option

  const remove = async () => {
    setConfirming(false)
    if (!(await actions.remove(id))) return
    onClose()
    notifier.info(`『${title}』を削除しました`)
  }

  return (
    <>
      <button type="button" className={styles.remove} onClick={() => setConfirming(true)}>
        🗑 この項目を削除
      </button>
      <ConfirmDialog
        open={confirming}
        message={`『${title}』を削除しますか？`}
        confirmLabel="削除"
        danger
        onConfirm={() => void remove()}
        onCancel={() => setConfirming(false)}
      />
    </>
  )
}
