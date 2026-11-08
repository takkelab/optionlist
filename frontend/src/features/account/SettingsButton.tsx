import { useCallback, useState } from 'react'
import { IconButton } from '../../components/IconButton'
import { SettingsSheet } from './SettingsSheet'

// やりたいリスト・やったリストのヘッダーの右の「⚙」（44×44px）。押すと設定のシートを開く（screens.md §9）
export function SettingsButton() {
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  return (
    <>
      <IconButton icon="settings" label="設定" expanded={open} onClick={() => setOpen(true)} />
      <SettingsSheet open={open} onClose={close} />
    </>
  )
}
