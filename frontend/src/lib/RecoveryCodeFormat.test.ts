import { describe, expect, it } from 'vitest'
import { RecoveryCodeFormat } from './RecoveryCodeFormat'

describe('RecoveryCodeFormat', () => {
  const format = new RecoveryCodeFormat()

  it.each([
    ['', ''],
    ['abc', 'ABC'],
    ['abcd', 'ABCD'],
    ['abcde', 'ABCD-E'],
    ['ABCD-EFGH-JKMN-PQRS', 'ABCD-EFGH-JKMN-PQRS'],
    ['abcd efgh jkmn pqrs', 'ABCD-EFGH-JKMN-PQRS'],
    ['ABCD-EFGH-JKMN-PQRS-TUVW', 'ABCD-EFGH-JKMN-PQRS'],
    ['ab－cd・ef', 'ABCD-EF'],
  ])('shows %j as %j', (input, expected) => {
    expect(format.display(input)).toBe(expected)
  })

  it.each([
    ['ABCD-EFGH-JKMN-PQRS', true],
    ['abcdefghjkmnpqrs', true],
    ['ABCD-EFGH-JKMN-PQR', false],
  ])('treats %j as complete: %s', (input, expected) => {
    expect(format.complete(input)).toBe(expected)
  })
})
