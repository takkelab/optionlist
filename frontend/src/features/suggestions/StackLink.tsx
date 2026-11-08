import type { ComponentProps } from 'react'
import { Link } from 'react-router'
import { useStackSlide } from './useStackSlide'

type Props = Omit<ComponentProps<typeof Link>, 'to' | 'onClick'> & { to: string }

// 提案の画面（提案 1 件・タグ・テーマ）へのリンク。押すと次の画面が右から入る（useStackSlide）
export function StackLink({ to, ...rest }: Props) {
  const stack = useStackSlide()
  return <Link to={to} onClick={(event) => stack.forward(event, to)} {...rest} />
}
