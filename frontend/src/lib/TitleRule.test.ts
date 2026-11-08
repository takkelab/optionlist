import { describe, expect, it } from 'vitest'
import { TitleRule } from './TitleRule'

const rule = new TitleRule()

describe('TitleRule.normalize', () => {
  it('trims half-width and full-width spaces', () => {
    expect(rule.normalize(' 　 山に登る 　')).toBe('山に登る')
  })

  it.each([[''], ['   '], ['　　']])('rejects a blank title %j', (input) => {
    expect(rule.normalize(input)).toBeNull()
  })

  it('accepts 200 characters and rejects 201', () => {
    expect(rule.normalize('あ'.repeat(200))).toBe('あ'.repeat(200))
    expect(rule.normalize('あ'.repeat(201))).toBeNull()
  })

  // 絵文字はサロゲートペアなので length では 2 になるが、1 文字に数える（backend と同じ）
  it('counts an emoji as one character', () => {
    expect(rule.normalize('🎉'.repeat(200))).toBe('🎉'.repeat(200))
    expect(rule.normalize('🎉'.repeat(201))).toBeNull()
  })
})
