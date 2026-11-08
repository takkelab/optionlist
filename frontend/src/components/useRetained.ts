import { useState } from 'react'

// null になっても直前の値を返す。モーダルが閉じる動きの間（useModal）、中身を出しておくのに使う
export function useRetained<T>(value: T | null): T | null {
  const [last, setLast] = useState(value)
  if (value !== null && value !== last) setLast(value)
  return value ?? last
}
