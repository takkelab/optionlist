import { describe, expect, it } from 'vitest'
import type { Option } from '../../../shared/types'
import { DoneListOrder } from './DoneListOrder'

interface DoneSampleSource {
  option(id: number, completedAt: string, plannedOn?: string): Option
}

class DoneSamples implements DoneSampleSource {
  option(id: number, completedAt: string, plannedOn?: string): Option {
    return {
      id,
      title: `項目 ${id}`,
      status: 'completed',
      suggestionId: null,
      plannedOn: plannedOn ?? null,
      achievementCount: 0,
      latestPhotoUrl: null,
      completedAt,
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z',
    }
  }
}

const samples = new DoneSamples()
const order = new DoneListOrder()

describe('DoneListOrder', () => {
  it('puts the newest move on top, and the larger id first on the same time (api.md §2)', () => {
    const list = [
      samples.option(1, '2026-11-01T00:00:00.000Z'),
      samples.option(2, '2026-11-03T00:00:00.000Z'),
      samples.option(3, '2026-11-01T00:00:00.000Z'),
    ]
    expect(order.arrange(list).map((o) => o.id)).toEqual([2, 3, 1])
  })

  it('does not sort by the plan date', () => {
    const list = [samples.option(1, '2026-11-03T00:00:00.000Z'), samples.option(2, '2026-11-01T00:00:00.000Z', '2026-01-01')]
    expect(order.moveToTopOfUndated(list, 2).map((o) => o.id)).toEqual([1, 2])
  })
})
