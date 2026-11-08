import { describe, expect, it } from 'vitest'
import { PRAISE_LINE_MAX, PRAISES, PraiseMessages } from './PraiseMessages'

const praises = new PraiseMessages()

describe('PraiseMessages.for', () => {
  it('praises the first achievement as a new experience', () => {
    expect(praises.for(0)).toBe(PRAISES.first)
  })

  it.each([1, 2, 10])('uses the repeat message after %d achievements', (count) => {
    expect(praises.for(count)).toBe(PRAISES.repeat)
  })

  // 長い文言はブラウザが言葉の途中で折り返すので、言葉の切れ目に改行を書いておく
  it.each(Object.values(PRAISES))('fits each line of %j in the card on a phone', (message) => {
    for (const line of message.split('\n')) expect([...line].length).toBeLessThanOrEqual(PRAISE_LINE_MAX)
  })
})
