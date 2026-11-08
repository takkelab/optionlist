import type { SuggestionCatalog, SuggestionSize, SuggestionSummary, Tag, Theme } from '../../../shared/types'

// 探す画面の棚 1 つに出す最大の件数（今日すぐできる・テーマの棚）
const SHELF_LIMIT = 6

// suggestions は棚に出す分（最大 6 件）。total は絞る前の、そのテーマの全件の数（「すべて 11 件」）
export type ThemeGroup = { theme: Theme; suggestions: SuggestionSummary[]; total: number }
export type ThemedSuggestions = { theme: Theme; suggestions: SuggestionSummary[] }
export type TaggedSuggestions = { tag: Tag; suggestions: SuggestionSummary[] }

export interface SuggestionBrowser {
  // 今月のおすすめ: 季節が month（1〜12）に当たる提案。size を選んでいればそれだけ
  monthPicks(catalog: SuggestionCatalog, month: number, size: SuggestionSize | null): SuggestionSummary[]
  // 今日すぐできる: 1 時間以内で、通年か季節が month に当たる提案を、テーマの順にテーマごと 1 件（最大 6 件）
  quickPicks(catalog: SuggestionCatalog, month: number): SuggestionSummary[]
  // テーマの棚。季節が month に当たるものを先に、ほかは id 順で最大 6 件。絞って空になったテーマは出さない
  themeGroups(catalog: SuggestionCatalog, month: number, size: SuggestionSize | null): ThemeGroup[]
  // テーマの一覧。themeParam はパスの :themeId のまま。存在しないテーマ（数字でないものを含む）なら null
  themed(catalog: SuggestionCatalog, themeParam: string | undefined): ThemedSuggestions | null
  // タグの一覧。tagParam はパスの :tagId のまま。存在しないタグ（数字でないものを含む）なら null
  tagged(catalog: SuggestionCatalog, tagParam: string | undefined): TaggedSuggestions | null
  // パスの :id・:tagId を正の整数に読む。数字でなければ null（その提案・タグは存在しない）
  routeId(param: string | undefined): number | null
}

// 探す画面・テーマの一覧・タグの一覧の並べ方と絞り込み（screens.md §5）。catalog は themes を sort_order 順、tags と suggestions を id 順で受け取る（api.md §4）
export class SuggestionBrowse implements SuggestionBrowser {
  monthPicks({ suggestions }: SuggestionCatalog, month: number, size: SuggestionSize | null): SuggestionSummary[] {
    return this.#sized(suggestions, size).filter((s) => this.#inSeason(s, month))
  }

  quickPicks({ themes, suggestions }: SuggestionCatalog, month: number): SuggestionSummary[] {
    const doable = suggestions.filter((s) => s.size === 'hour' && (s.seasonFrom === null || this.#inSeason(s, month)))
    const firsts = themes.map((theme) => doable.find((s) => s.themeId === theme.id))
    return firsts.filter((s) => s !== undefined).slice(0, SHELF_LIMIT)
  }

  themeGroups({ themes, suggestions }: SuggestionCatalog, month: number, size: SuggestionSize | null): ThemeGroup[] {
    const groups = themes.map((theme) => {
      const inTheme = suggestions.filter((s) => s.themeId === theme.id)
      const sized = this.#sized(inTheme, size)
      const inSeason = sized.filter((s) => this.#inSeason(s, month))
      const others = sized.filter((s) => !this.#inSeason(s, month))
      return { theme, suggestions: [...inSeason, ...others].slice(0, SHELF_LIMIT), total: inTheme.length }
    })
    return groups.filter(({ suggestions: shelf }) => shelf.length > 0)
  }

  themed({ themes, suggestions }: SuggestionCatalog, themeParam: string | undefined): ThemedSuggestions | null {
    const id = this.routeId(themeParam)
    const theme = themes.find((t) => t.id === id)
    if (theme === undefined) return null
    return { theme, suggestions: suggestions.filter(({ themeId }) => themeId === theme.id) }
  }

  tagged({ tags, suggestions }: SuggestionCatalog, tagParam: string | undefined): TaggedSuggestions | null {
    const id = this.routeId(tagParam)
    const tag = tags.find((t) => t.id === id)
    if (tag === undefined) return null
    return { tag, suggestions: suggestions.filter(({ tagIds }) => tagIds.includes(tag.id)) }
  }

  routeId(param: string | undefined): number | null {
    return param !== undefined && /^[1-9]\d{0,9}$/.test(param) ? Number(param) : null
  }

  #sized(suggestions: SuggestionSummary[], size: SuggestionSize | null): SuggestionSummary[] {
    return size === null ? suggestions : suggestions.filter((s) => s.size === size)
  }

  // 季節は seasonFrom 月〜seasonTo 月（両端を含む）。12 → 2 のように年をまたいでよい。通年（null）は今月のおすすめに入れない
  #inSeason({ seasonFrom, seasonTo }: SuggestionSummary, month: number): boolean {
    if (seasonFrom === null || seasonTo === null) return false
    return seasonFrom <= seasonTo ? seasonFrom <= month && month <= seasonTo : month >= seasonFrom || month <= seasonTo
  }
}
