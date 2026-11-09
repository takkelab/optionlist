import { describe, expect, it } from 'vitest'
import { RecoveryPrompt } from './RecoveryPrompt'
import type { PromptState } from './RecoveryPrompt'

const BASE: PromptState = {
  pendingCount: 0,
  photoSaved: false,
  answered: false,
  account: { hasAccount: true, hasRecoveryCode: false },
  sheetOpen: false,
}

describe('RecoveryPrompt', () => {
  const prompt = new RecoveryPrompt()

  it.each<[string, Partial<PromptState>, boolean]>([
    ['nothing yet', {}, false],
    ['4 items', { pendingCount: 4 }, false],
    ['5 items', { pendingCount: 5 }, true],
    ['the first photo', { photoSaved: true }, true],
    ['an answered prompt or a code issued anywhere', { pendingCount: 5, answered: true }, false],
    ['an issued code', { pendingCount: 5, account: { hasAccount: true, hasRecoveryCode: true } }, false],
    // すべて消した・前の端末で引き継がれたあと。端末に「写真を保存した」が残っていても出さない（発行は 404 になる）
    ['no account', { photoSaved: true, account: { hasAccount: false, hasRecoveryCode: false } }, false],
    ['an unknown account status', { pendingCount: 5, account: null }, false],
    ['an open sheet', { photoSaved: true, sheetOpen: true }, false],
  ])('shows the card after %s: %s', (_case, state, expected) => {
    expect(prompt.shows({ ...BASE, ...state })).toBe(expected)
  })

  // アカウントの状態は、ほかの条件がそろったときだけ読む（開くたびに読まない）
  it.each<[Partial<PromptState>, boolean]>([
    [{}, false],
    [{ pendingCount: 5 }, true],
    [{ photoSaved: true, answered: true }, false],
  ])('needs the account status for %j: %s', (state, expected) => {
    expect(prompt.needsStatus({ ...BASE, ...state })).toBe(expected)
  })
})
