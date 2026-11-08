import { useState } from 'react'
import type { Option } from '../../../../shared/types'

export type OpenedOption = {
  // 項目のシートで開いている項目。閉じているか、一覧から消えたら（削除・移したら）null
  opened: Option | null
  open(option: Option): void
  close(): void
}

// やりたいリスト・やったリストで、項目のシート（screens.md §3）に出す項目。id で覚え、中身は今の一覧から引く（変更がすぐシートに出る）
export function useOpenedOption(options: Option[] | null): OpenedOption {
  const [openId, setOpenId] = useState<number | null>(null)
  return {
    opened: options?.find((o) => o.id === openId) ?? null,
    open: (option) => setOpenId(option.id),
    close: () => setOpenId(null),
  }
}
