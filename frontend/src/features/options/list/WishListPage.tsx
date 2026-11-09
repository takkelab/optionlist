import { useState } from 'react'
import { Link } from 'react-router'
import { PageHeader } from '../../../components/PageHeader'
import { RecoveryPromptCard } from '../../account/RecoveryPromptCard'
import { SettingsButton } from '../../account/SettingsButton'
import styles from '../OptionList.module.css'
import { OptionSheet } from '../OptionSheet'
import { StatusSwitch } from '../StatusSwitch'
import { TitleDialog } from '../TitleDialog'
import { useOpenedOption } from '../useOpenedOption'
import { AddDialogNote } from './AddDialogNote'
import { AddFab } from './AddFab'
import { SortableWishList } from './SortableWishList'
import { TodayPick } from './TodayPick'
import { useWishList } from './useWishList'

// screens.md §2: やりたいリスト（/）
export function WishListPage() {
  const { options, loaded, add, reorder, actions } = useWishList()
  const [adding, setAdding] = useState(false)
  const { opened, open, close } = useOpenedOption(options)

  return (
    <>
      <PageHeader title="やりたいこと" center={<StatusSwitch />} end={<SettingsButton />} />
      {options !== null && <RecoveryPromptCard pendingCount={options.length} sheetOpen={opened !== null} />}
      {options !== null && options.length >= 2 && <TodayPick options={options} onOpen={open} />}
      {options !== null && options.length === 0 && (
        <div className={styles.empty}>
          <p>まだ何もありません</p>
          <Link to="/suggestions" className={styles.emptyLink}>
            提案から追加してみよう
          </Link>
        </div>
      )}
      {options !== null && <SortableWishList options={options} disabled={!loaded} onOpen={open} onReorder={reorder} />}
      <AddFab onClick={() => setAdding(true)} />
      <OptionSheet option={opened} onClose={close} actions={actions} />
      <TitleDialog
        open={adding}
        heading="やりたいことを追加"
        submitLabel="追加"
        onClose={() => setAdding(false)}
        onSubmit={add}
        note={<AddDialogNote open={adding} />}
      />
    </>
  )
}
