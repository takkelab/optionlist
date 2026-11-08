import { describe, expect, it } from 'vitest'
import type { Option } from '../../../shared/types'
import { KeepAdded, ReplaceList } from './ListMerge'
import { WishListOrder } from './WishListOrder'

interface MergeSampleSource {
  option(id: number): Option
}

class MergeSamples implements MergeSampleSource {
  option(id: number): Option {
    return {
      id,
      title: `項目 ${id}`,
      status: 'pending',
      suggestionId: null,
      plannedOn: null,
      achievementCount: 0,
      latestPhotoUrl: null,
      completedAt: null,
      createdAt: '2026-11-03T00:00:00.000Z',
      updatedAt: '2026-11-03T00:00:00.000Z',
    }
  }
}

const samples = new MergeSamples()

describe('ReplaceList.merge', () => {
  it('uses the loaded list', () => {
    expect(new ReplaceList().merge([samples.option(1)], [samples.option(2)])).toEqual([samples.option(2)])
  })
})

describe('KeepAdded.merge', () => {
  it('drops cards shown from the recent list that the loaded list no longer has', () => {
    const merge = new KeepAdded(new WishListOrder())
    expect(merge.merge([samples.option(1), samples.option(2)], [samples.option(2)])).toEqual([samples.option(2)])
  })

  it('keeps a card added on the screen before the list arrived, at the top of the undated ones', () => {
    const merge = new KeepAdded(new WishListOrder())
    merge.added(3)
    expect(merge.merge([samples.option(3)], [samples.option(1)]).map((o) => o.id)).toEqual([3, 1])
  })

  it('does not repeat an added card that the loaded list already has', () => {
    const merge = new KeepAdded(new WishListOrder())
    merge.added(3)
    expect(merge.merge([samples.option(3)], [samples.option(3), samples.option(1)]).map((o) => o.id)).toEqual([3, 1])
  })
})
