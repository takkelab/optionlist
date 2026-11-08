import { useState } from 'react'
import type { Option } from '../../../../shared/types'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import type { ListActions } from '../../lib/OptionListActions'
import styles from './OptionSheet.module.css'

// 提案から開くシートの上の文（screens.md §5）。やったリストにある項目は「やったリストにあります」
const NOTICE = { added: 'やりたいリストに入れました', reopened: 'やりたいリストにあります' } as const

type Props = {
  option: Option
  // added: 追加した直後 / reopened: 提案 1 件の画面のボタンから開き直した
  origin: keyof typeof NOTICE
  actions: ListActions
  onClose: () => void
}

// 提案 1 件の画面から開いたシートの一番上。やりたいリストにある項目には [取り消す] を付ける（docs/decisions/0025）
export function SheetNotice({ option, origin, actions, onClose }: Props) {
  const [confirming, setConfirming] = useState(false)
  // 消している間は押せなくする（2 回目の削除が 404 になり、消せているのに失敗のトーストが出るので）
  const [undoing, setUndoing] = useState(false)
  const { id, title, status } = option

  // 消したことはボタンが戻ることで分かるので、トーストは出さない
  const undo = async () => {
    setConfirming(false)
    setUndoing(true)
    const removed = await actions.remove(id)
    setUndoing(false)
    if (removed) onClose()
  }
  // 達成記録は追加し直しても戻らないので、あるときだけ確かめる
  const ask = () => {
    if (option.achievementCount > 0) setConfirming(true)
    else void undo()
  }

  return (
    <div className={styles.notice}>
      <p className={styles.noticeText} data-sheet-notice>
        <span className={styles.check} aria-hidden="true">
          ✓
        </span>
        {status === 'pending' ? NOTICE[origin] : 'やったリストにあります'}
      </p>
      {status === 'pending' && (
        <button type="button" className={styles.undo} onClick={ask} disabled={undoing}>
          取り消す
        </button>
      )}
      <ConfirmDialog
        open={confirming}
        message={`『${title}』をやりたいリストから外しますか？ 達成した日の記録も消えます`}
        confirmLabel="外す"
        cancelLabel="やめる"
        danger
        onConfirm={() => void undo()}
        onCancel={() => setConfirming(false)}
      />
    </div>
  )
}
