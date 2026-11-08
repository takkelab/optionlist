import { createContext } from 'react'
import type { OptionsApi, SuggestionsApi } from '../api/client'
import type { CatalogLoader } from '../lib/CatalogCache'
import type { ListLoader } from '../lib/ListPrefetch'
import type { ScrollMemory } from '../lib/ScrollMemory'

// 画面から使う依存は Context で渡す（architecture.md §3.1）。テストではフェイクを渡せる
export interface Notifier {
  // 失敗をトーストで知らせる。error は console.warn に出す（握り潰さない）
  error(message: string, error: unknown): void
  // 操作の結果をトーストで知らせる（「相談文をコピーしました」など）
  info(message: string): void
}

export const OptionsApiContext = createContext<OptionsApi | null>(null)
export const NotifierContext = createContext<Notifier | null>(null)
// やりたいリスト・やったリストの読み込み（切り替えに指が触れたときの先読みを含む）
export const ListLoaderContext = createContext<ListLoader | null>(null)
export const SuggestionsApiContext = createContext<SuggestionsApi | null>(null)
// 提案の一覧（戻ったときに最近読んだものをすぐ出す）
export const CatalogLoaderContext = createContext<CatalogLoader | null>(null)
// 戻ったときのスクロール位置（探す画面・タグの一覧）
export const ScrollMemoryContext = createContext<ScrollMemory | null>(null)
