import { describe, expect, it } from 'vitest'
import { ScrollVisibility } from './ScrollVisibility'

// 一番上から 64px までは常に出す。8px 未満の動きは無視する（ケースごとに new する）

describe('ScrollVisibility.update', () => {
  it('shows the header near the top', () => {
    const t = new ScrollVisibility(64, 8)
    expect(t.update(0)).toBe(true)
    expect(t.update(64)).toBe(true)
  })

  it('hides when scrolling down and shows again when scrolling back up', () => {
    const t = new ScrollVisibility(64, 8)
    t.update(0)
    expect(t.update(100)).toBe(false)
    expect(t.update(300)).toBe(false)
    expect(t.update(280)).toBe(true)
    expect(t.update(320)).toBe(false)
  })

  // 少しずつ動くスクロールでも、前に判定した位置からの合計で判定する
  it('accumulates small moves until they pass the threshold', () => {
    const t = new ScrollVisibility(64, 8)
    t.update(0)
    t.update(200)
    expect(t.update(196)).toBe(false)
    expect(t.update(192)).toBe(true)
  })

  // 画面を開いた時点で下のほうにいても（前の画面のスクロール位置が残ったときなど）、最初の位置は下向きの動きとみなさない
  // 詳細画面の「開いたら一番下までスクロール」は読み込みのあとに動くので、ステップ 5 で覚え直す仕組みが要る
  it('keeps the header shown on the first update even far from the top', () => {
    const t = new ScrollVisibility(64, 8)
    expect(t.update(500)).toBe(true)
    expect(t.update(600)).toBe(false)
  })

  it('always shows the header again when it comes back near the top', () => {
    const t = new ScrollVisibility(64, 8)
    t.update(0)
    t.update(300)
    expect(t.update(60)).toBe(true)
  })
})
