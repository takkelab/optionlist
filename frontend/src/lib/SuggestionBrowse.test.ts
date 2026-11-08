import { describe, expect, it } from 'vitest'
import type { SuggestionCatalog, SuggestionSummary } from '../../../shared/types'
import { SuggestionBrowse } from './SuggestionBrowse'

const base: SuggestionSummary = {
  id: 0,
  hook: '',
  title: '',
  size: 'hour',
  seasonFrom: null,
  seasonTo: null,
  themeId: 1,
  tagIds: [],
  optionStatus: null,
}

// テーマはわざと id と違う順（sort_order 順）に並べておく
const catalog: SuggestionCatalog = {
  themes: [
    { id: 2, name: '夜空' },
    { id: 1, name: '食べる' },
    { id: 3, name: '空のテーマ' },
  ],
  tags: [
    { id: 1, name: '星' },
    { id: 2, name: '冬' },
    { id: 3, name: 'だれも使わない' },
  ],
  suggestions: [
    { ...base, id: 1, themeId: 2, seasonFrom: 12, seasonTo: 2, tagIds: [1, 2] },
    { ...base, id: 2, themeId: 1, size: 'day', seasonFrom: 11, seasonTo: 12, tagIds: [2] },
    { ...base, id: 3, themeId: 2, size: 'day', tagIds: [1] },
    { ...base, id: 4, themeId: 1, seasonFrom: 6, seasonTo: 6 },
  ],
}

const browse = new SuggestionBrowse()

describe('SuggestionBrowse.monthPicks', () => {
  it.each([
    [12, [1, 2]],
    [1, [1]],
    [2, [1]],
    [3, []],
    [6, [4]],
    [11, [2]],
  ])('picks suggestions in season for month %d (wrapping the year, excluding all-year ones)', (month, ids) => {
    expect(browse.monthPicks(catalog, month, null).map((s) => s.id)).toEqual(ids)
  })

  it('narrows by size', () => {
    expect(browse.monthPicks(catalog, 12, 'day').map((s) => s.id)).toEqual([2])
  })
})

describe('SuggestionBrowse.quickPicks', () => {
  it.each([
    [12, [1]],
    [6, [4]],
    [3, []],
  ])('picks the first hour-long suggestion in season or all-year per theme for month %d', (month, ids) => {
    expect(browse.quickPicks(catalog, month).map((s) => s.id)).toEqual(ids)
  })

  it('picks all-year ones and keeps theme order, up to 6', () => {
    const themes = Array.from({ length: 8 }, (_, i) => ({ id: 8 - i, name: `テーマ ${8 - i}` }))
    const suggestions = themes.map(({ id }) => ({ ...base, id, themeId: id }))
    const picks = browse.quickPicks({ themes, tags: [], suggestions }, 3)
    expect(picks.map((s) => s.id)).toEqual([8, 7, 6, 5, 4, 3])
  })

  it('takes the smallest id in a theme, skipping ones out of season or not hour-long', () => {
    const suggestions = [
      { ...base, id: 1, seasonFrom: 6, seasonTo: 6 },
      { ...base, id: 2, size: 'day' as const },
      { ...base, id: 3 },
      { ...base, id: 4 },
    ]
    const picks = browse.quickPicks({ themes: [{ id: 1, name: '食べる' }], tags: [], suggestions }, 3)
    expect(picks.map((s) => s.id)).toEqual([3])
  })
})

describe('SuggestionBrowse.themeGroups', () => {
  it('puts suggestions in season first, then the rest in id order', () => {
    const groups = browse.themeGroups(catalog, 6, null)
    expect(groups.map(({ suggestions }) => suggestions.map((s) => s.id))).toEqual([
      [1, 3],
      [4, 2],
    ])
  })

  it('shows up to 6 suggestions per theme', () => {
    const suggestions = Array.from({ length: 8 }, (_, i) => ({ ...base, id: i + 1, themeId: 1 }))
    const [group] = browse.themeGroups({ themes: [{ id: 1, name: '食べる' }], tags: [], suggestions }, 3, null)
    expect(group).toMatchObject({ suggestions: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }, { id: 6 }], total: 8 })
    expect(group?.suggestions).toHaveLength(6)
  })

  it('moves suggestions in season ahead before cutting to 6', () => {
    // 7・8 件目だけが 3 月の季節
    const suggestions = Array.from({ length: 8 }, (_, i) => {
      const season = i >= 6 ? 3 : null
      return { ...base, id: i + 1, themeId: 1, seasonFrom: season, seasonTo: season }
    })
    const [group] = browse.themeGroups({ themes: [{ id: 1, name: '食べる' }], tags: [], suggestions }, 3, null)
    expect(group).toMatchObject({ suggestions: [{ id: 7 }, { id: 8 }, { id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }] })
  })

  it('groups by theme in theme order and drops empty themes', () => {
    const groups = browse.themeGroups(catalog, 3, null)
    expect(groups.map(({ theme: { name }, suggestions }) => [name, suggestions.map((s) => s.id)])).toEqual([
      ['夜空', [1, 3]],
      ['食べる', [2, 4]],
    ])
  })

  it('drops themes that become empty after narrowing by size', () => {
    const groups = browse.themeGroups(catalog, 3, 'overnight')
    expect(groups).toEqual([])
    const days = browse.themeGroups(catalog, 3, 'day')
    expect(days.map(({ theme: { name }, suggestions }) => [name, suggestions.map((s) => s.id)])).toEqual([
      ['夜空', [3]],
      ['食べる', [2]],
    ])
  })

  it('counts every suggestion of the theme in total, even after narrowing', () => {
    expect(browse.themeGroups(catalog, 3, null).map((g) => g.total)).toEqual([2, 2])
    expect(browse.themeGroups(catalog, 3, 'day').map((g) => g.total)).toEqual([2, 2])
  })
})

describe('SuggestionBrowse.themed', () => {
  it('returns the theme and all its suggestions in id order', () => {
    const themed = browse.themed(catalog, '2')
    expect(themed).toMatchObject({ theme: { id: 2, name: '夜空' }, suggestions: [{ id: 1 }, { id: 3 }] })
  })

  it('returns an empty list for a theme with no suggestions', () => {
    expect(browse.themed(catalog, '3')).toMatchObject({ suggestions: [] })
  })

  it.each([undefined, '99', 'abc', '0', '01', '1.5'])('returns null for theme param %s', (param) => {
    expect(browse.themed(catalog, param)).toBeNull()
  })
})

describe('SuggestionBrowse.tagged', () => {
  it('returns the tag and its suggestions in id order', () => {
    const tagged = browse.tagged(catalog, '1')
    expect(tagged).toMatchObject({ tag: { id: 1, name: '星' }, suggestions: [{ id: 1 }, { id: 3 }] })
  })

  it('returns an empty list for a tag no suggestion uses', () => {
    expect(browse.tagged(catalog, '3')).toMatchObject({ suggestions: [] })
  })

  it.each([undefined, '99', 'abc', '0', '-1', '1.5', '01', ' 1', '99999999999'])('returns null for tag param %s', (param) => {
    expect(browse.tagged(catalog, param)).toBeNull()
  })
})

describe('SuggestionBrowse.routeId', () => {
  it.each([
    ['1', 1],
    ['42', 42],
    ['4294967295', 4294967295],
    [undefined, null],
    ['', null],
    ['abc', null],
    ['0', null],
    ['-1', null],
    ['01', null],
    ['1e3', null],
    ['12345678901', null],
  ])('reads %s as %s', (param, expected) => {
    expect(browse.routeId(param)).toBe(expected)
  })
})
