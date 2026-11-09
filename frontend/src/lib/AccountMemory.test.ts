import { describe, expect, it } from 'vitest'
import { AccountMemory } from './AccountMemory'
import type { KeyValueStore } from './AccountMemory'

// メモリ上の localStorage
class MemoryStore implements KeyValueStore {
  readonly #values = new Map<string, string>()

  get(key: string): string | null {
    return this.#values.get(key) ?? null
  }

  set(key: string, value: string): void {
    this.#values.set(key, value)
  }

  remove(key: string): void {
    this.#values.delete(key)
  }
}

describe('AccountMemory', () => {
  it('remembers nothing at first', () => {
    const memory = new AccountMemory(new MemoryStore())
    expect([memory.photoSaved(), memory.promptAnswered(), memory.needsNewCode()]).toEqual([false, false, false])
  })

  it('remembers the first photo, the answer and the need for a new code', () => {
    const store = new MemoryStore()
    const memory = new AccountMemory(store)
    memory.markPhotoSaved()
    memory.answerPrompt()
    memory.setNeedsNewCode(true)
    const again = new AccountMemory(store)
    expect([again.photoSaved(), again.promptAnswered(), again.needsNewCode()]).toEqual([true, true, true])
    again.setNeedsNewCode(false)
    expect(again.needsNewCode()).toBe(false)
  })
})
