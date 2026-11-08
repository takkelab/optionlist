import { IconButton } from '../../components/IconButton'
import { useStackSlide } from './useStackSlide'

// 提案 1 件・タグの一覧・テーマの一覧のヘッダーの戻るボタン（screens.md §5）。履歴を 1 つ戻り、前の画面が左から戻る
export function BackButton() {
  const stack = useStackSlide()
  return <IconButton icon="back" label="戻る" onClick={stack.back} />
}
