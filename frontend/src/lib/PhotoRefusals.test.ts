import { describe, expect, it } from 'vitest'
import { PhotoRefusals } from './PhotoRefusals'

// 写真の 429 の理由（api.md §3、screens.md §7）
describe('PhotoRefusals', () => {
  const refusals = new PhotoRefusals()

  it.each([
    ['the limit per person', 429, { error: { code: 'PHOTO_LIMIT_REACHED', message: 'x' } }, 'full'],
    ['the rate limit', 429, { error: { code: 'TOO_MANY_REQUESTS', message: 'x' } }, 'busy'],
    ['a 429 without a JSON body', 429, '', 'busy'],
    ['a 429 with a null body', 429, null, 'busy'],
    ['a 429 with another shape', 429, { error: 'x' }, 'busy'],
    ['another status', 500, { error: { code: 'PHOTO_LIMIT_REACHED', message: 'x' } }, null],
    ['no response', undefined, undefined, null],
  ])('reads %s', (_name, status, body, reason) => {
    expect(refusals.reasonOf(status, body)).toBe(reason)
  })
})
