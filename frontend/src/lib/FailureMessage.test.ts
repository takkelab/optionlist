import { describe, expect, it } from 'vitest'
import { FailureMessage, OFFLINE_MESSAGE } from './FailureMessage'

// 失敗のトーストの文言（screens.md §7）
describe('FailureMessage', () => {
  it('keeps the message of the failure while online', () => {
    const rule = new FailureMessage(() => true)
    expect(rule.toastText('一覧を読み込めませんでした')).toBe('一覧を読み込めませんでした')
  })

  it('shows the offline message for any failure while offline', () => {
    const rule = new FailureMessage(() => false)
    expect(rule.toastText('一覧を読み込めませんでした')).toBe(OFFLINE_MESSAGE)
    expect(rule.toastText('並び替えを保存できませんでした')).toBe(OFFLINE_MESSAGE)
  })

  it('reads whether it is online each time', () => {
    let online = true
    const rule = new FailureMessage(() => online)
    expect(rule.toastText('x')).toBe('x')
    online = false
    expect(rule.toastText('x')).toBe(OFFLINE_MESSAGE)
  })
})
