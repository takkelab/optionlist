import { describe, expect, it } from 'vitest'
import { PhotoSize } from './PhotoSize'

const size = new PhotoSize()

describe('PhotoSize.fit', () => {
  it('shrinks a landscape photo to the long side limit', () => {
    expect(size.fit({ width: 4000, height: 3000 })).toEqual({ width: 1280, height: 960 })
  })

  it('shrinks a portrait photo to the long side limit', () => {
    expect(size.fit({ width: 3000, height: 4000 })).toEqual({ width: 960, height: 1280 })
  })

  it('does not enlarge a small photo', () => {
    expect(size.fit({ width: 800, height: 600 })).toEqual({ width: 800, height: 600 })
  })

  it('keeps a photo exactly at the limit', () => {
    expect(size.fit({ width: 1280, height: 1280 })).toEqual({ width: 1280, height: 1280 })
  })

  it('keeps at least 1 pixel for a very thin photo', () => {
    expect(size.fit({ width: 10000, height: 1 })).toEqual({ width: 1280, height: 1 })
  })
})
