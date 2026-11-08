import { describe, expect, it } from 'vitest'
import type { Option } from '../../../shared/types'
import { WishListOrder } from './WishListOrder'

interface SampleSource {
  option(id: number, plannedOn: string | null): Option
}

// テスト用の項目
class Samples implements SampleSource {
  option(id: number, plannedOn: string | null): Option {
    return {
      id,
      title: `項目 ${id}`,
      status: 'pending',
      suggestionId: null,
      plannedOn,
      achievementCount: 0,
      latestPhotoUrl: null,
      completedAt: null,
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z',
    }
  }
}

const samples = new Samples()
const order = new WishListOrder()

describe('WishListOrder.arrange', () => {
  it('puts options with a plan date first in date order (id order on the same day) and keeps the rest in the current order', () => {
    const list = [
      samples.option(1, null),
      samples.option(5, '2026-12-01'),
      samples.option(3, null),
      samples.option(4, '2026-11-23'),
      samples.option(2, '2026-12-01'),
    ]
    // 同じ日（2 と 5）は今の並びによらず id の順
    expect(order.arrange(list).map((o) => o.id)).toEqual([4, 2, 5, 1, 3])
  })
})

describe('WishListOrder.moveToTopOfUndated', () => {
  it('moves the option just below the ones with a plan date', () => {
    const list = [samples.option(1, '2026-11-23'), samples.option(2, null), samples.option(3, null), samples.option(4, null)]
    expect(order.moveToTopOfUndated(list, 3).map((o) => o.id)).toEqual([1, 3, 2, 4])
  })
})

describe('WishListOrder.move', () => {
  const list = [samples.option(1, '2026-11-23'), samples.option(2, null), samples.option(3, null), samples.option(4, null)]

  it('moves an undated option up or down among the undated ones', () => {
    expect(order.move(list, 4, 2).map((o) => o.id)).toEqual([1, 4, 2, 3])
    expect(order.move(list, 2, 4).map((o) => o.id)).toEqual([1, 3, 4, 2])
  })

  it('returns the same list when dropped on itself, on a dated option, or for an unknown id', () => {
    expect(order.move(list, 3, 3)).toBe(list)
    expect(order.move(list, 3, 1)).toBe(list)
    expect(order.move(list, 1, 3)).toBe(list)
    expect(order.move(list, 9, 3)).toBe(list)
  })
})

describe('WishListOrder.undatedIds', () => {
  it('lists only the undated options in the current order', () => {
    const list = [samples.option(1, '2026-11-23'), samples.option(3, null), samples.option(2, null)]
    expect(order.undatedIds(list)).toEqual([3, 2])
  })
})
