import { useEffect, useState } from 'react'
import type { OptionDetail } from '../../../../shared/types'
import { useNotifier, useOptionsApi } from '../../app/hooks'

// 項目のシートの詳細（GET /api/options/:id）。達成した日と、提案から追加した項目の最初の一歩に使う（screens.md §3）
// シートを開いたときと 🎉 で回数が増えたとき、写真を変えたとき（photoRound が増える）に読み直す。読む間は null。
// 一覧の回数が 0 でも読む（別の端末で 🎉 を押して、この端末の一覧が古いことがある）
export function useOptionDetail(id: number, count: number, photoRound: number): OptionDetail | null {
  const api = useOptionsApi()
  const notifier = useNotifier()
  const [detail, setDetail] = useState<OptionDetail | null>(null)

  useEffect(() => {
    let active = true
    api
      .detail(id)
      .then((loaded) => {
        if (active) setDetail(loaded)
      })
      .catch((error: unknown) => notifier.error('達成した日を読み込めませんでした', error))
    return () => {
      active = false
    }
  }, [api, notifier, id, count, photoRound])

  return detail
}
