import { useContext } from 'react'
import type { Context } from 'react'
import type { OptionsApi, SuggestionsApi } from '../api/client'
import type { CatalogLoader } from '../lib/CatalogCache'
import type { ListLoader } from '../lib/ListPrefetch'
import type { ScrollMemory } from '../lib/ScrollMemory'
import {
  CatalogLoaderContext,
  ListLoaderContext,
  NotifierContext,
  OptionsApiContext,
  ScrollMemoryContext,
  SuggestionsApiContext,
} from './contexts'
import type { Notifier } from './contexts'

export function useOptionsApi(): OptionsApi {
  return useProvided(OptionsApiContext, 'OptionsApiContext')
}

export function useNotifier(): Notifier {
  return useProvided(NotifierContext, 'NotifierContext')
}

export function useListLoader(): ListLoader {
  return useProvided(ListLoaderContext, 'ListLoaderContext')
}

export function useSuggestionsApi(): SuggestionsApi {
  return useProvided(SuggestionsApiContext, 'SuggestionsApiContext')
}

export function useCatalogLoader(): CatalogLoader {
  return useProvided(CatalogLoaderContext, 'CatalogLoaderContext')
}

export function useScrollMemory(): ScrollMemory {
  return useProvided(ScrollMemoryContext, 'ScrollMemoryContext')
}

// AppProviders が渡した依存を読む。外で使っていたら（null なら）すぐ分かるように止める
function useProvided<T>(context: Context<T | null>, name: string): T {
  const value = useContext(context)
  if (value === null) throw new Error(`${name} がない（AppProviders の外で使っている）`)
  return value
}
