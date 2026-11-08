import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { domAnimation, LazyMotion, MotionConfig } from 'motion/react'
import type { EventsApi, OptionsApi, SuggestionsApi } from '../api/client'
import { Toast } from '../components/Toast'
import type { ToastKind } from '../components/Toast'
import { CatalogCache } from '../lib/CatalogCache'
import { ClientErrorReporter } from '../lib/ErrorReporter'
import { ListPrefetch } from '../lib/ListPrefetch'
import { HistoryScroll } from '../lib/ScrollMemory'
import {
  CatalogLoaderContext,
  ListLoaderContext,
  NotifierContext,
  OptionsApiContext,
  ScrollMemoryContext,
  SuggestionsApiContext,
} from './contexts'
import type { Notifier } from './contexts'

const TOAST_MS = 3000

type Props = { api: OptionsApi; suggestions: SuggestionsApi; events: EventsApi; children: ReactNode }

// 依存（API クライアント）とトーストを Context で配る。main.tsx が本物の HttpApiClient を渡す
// Motion は使う機能（domAnimation）だけを読み込み（初期表示の JS を抑える。metrics.md §3）、視差効果を減らす設定に従わせる
// トーストで知らせた失敗と、画面で拾えなかったエラーは client_error として送る（screens.md §8）
export function AppProviders({ api, suggestions, events, children }: Props) {
  // 同じ文言が続いても出し直すたびに表示時間を延ばすよう、文言ではなく出した回の値で時間を測る
  const [toast, setToast] = useState<{ text: string; kind: ToastKind } | null>(null)

  useEffect(() => {
    if (toast === null) return undefined
    const timer = setTimeout(() => setToast(null), TOAST_MS)
    return () => clearTimeout(timer)
  }, [toast])

  const reporter = useMemo(() => new ClientErrorReporter(events, () => location.pathname), [events])
  useEffect(() => {
    const onError = (event: ErrorEvent) => reporter.report(event.error ?? event.message)
    const onRejection = (event: PromiseRejectionEvent) => reporter.report(event.reason)
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [reporter])

  const error = useCallback(
    (text: string, cause: unknown) => {
      console.warn(text, cause)
      reporter.report(cause, text)
      setToast({ text, kind: 'error' })
    },
    [reporter],
  )
  const info = useCallback((text: string) => setToast({ text, kind: 'info' }), [])
  const notifier = useMemo<Notifier>(() => ({ error, info }), [error, info])
  const loader = useMemo(() => new ListPrefetch(api), [api])
  const catalog = useMemo(() => new CatalogCache(suggestions), [suggestions])
  const [scroll] = useState(() => new HistoryScroll())

  return (
    <OptionsApiContext value={api}>
      <SuggestionsApiContext value={suggestions}>
        <ListLoaderContext value={loader}>
          <CatalogLoaderContext value={catalog}>
            <ScrollMemoryContext value={scroll}>
              <NotifierContext value={notifier}>
                <LazyMotion features={domAnimation} strict>
                  <MotionConfig reducedMotion="user">{children}</MotionConfig>
                </LazyMotion>
                <Toast message={toast === null ? null : toast.text} kind={toast === null ? 'error' : toast.kind} />
              </NotifierContext>
            </ScrollMemoryContext>
          </CatalogLoaderContext>
        </ListLoaderContext>
      </SuggestionsApiContext>
    </OptionsApiContext>
  )
}
