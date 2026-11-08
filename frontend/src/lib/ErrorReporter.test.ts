import { beforeEach, describe, expect, it } from 'vitest'
import type { Event } from '../../../shared/types'
import type { EventsApi } from '../api/client'
import { ClientErrorReporter } from './ErrorReporter'

// 送ったイベントを覚える API。fail を立てると送信が失敗する
class RecordingEventsApi implements EventsApi {
  readonly #sent: Event[] = []
  #fail = false

  send(events: Event[]): Promise<void> {
    if (this.#fail) return Promise.reject(new Error('POST が失敗した'))
    this.#sent.push(...events)
    return Promise.resolve()
  }

  failNext(): void {
    this.#fail = true
  }

  sent(): Event[] {
    return [...this.#sent]
  }

  messages(): unknown[] {
    return this.#sent.map(({ payload }) => payload.message)
  }
}

interface TestTime {
  now(): number
  warn(message: string, error: unknown): void
}

// 時刻を手で進める時計と、warn に出したものを覚える入れ物
class ManualTime implements TestTime {
  #at = Date.parse('2026-11-08T01:00:00.000Z')
  readonly #warnings: unknown[] = []

  now(): number {
    return this.#at
  }

  advance(ms: number): void {
    this.#at += ms
  }

  warn(message: string, error: unknown): void {
    this.#warnings.push([message, error])
  }

  warnings(): unknown[] {
    return [...this.#warnings]
  }
}

describe('ClientErrorReporter', () => {
  let api: RecordingEventsApi
  let time: ManualTime
  let route: string
  let reporter: ClientErrorReporter

  beforeEach(() => {
    api = new RecordingEventsApi()
    time = new ManualTime()
    route = '/suggestions/12'
    reporter = new ClientErrorReporter(
      api,
      () => route,
      () => time.now(),
      (message, error) => time.warn(message, error),
    )
  })

  it('sends a client_error with the message, the screen and the time it happened', () => {
    reporter.report(new TypeError('x is undefined'), '提案を読み込めませんでした')
    expect(api.sent()).toEqual([
      {
        type: 'client_error',
        payload: { message: '提案を読み込めませんでした: TypeError: x is undefined', route: '/suggestions/12' },
        occurredAt: '2026-11-08T01:00:00.000Z',
      },
    ])
  })

  it('describes strings, plain values and values that cannot be JSON', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    reporter.report('boom')
    reporter.report({ code: 1 })
    reporter.report(undefined)
    reporter.report(circular)
    expect(api.messages()).toEqual(['boom', '{"code":1}', 'undefined', '[object Object]'])
    expect(time.warnings()).toHaveLength(1)
  })

  it('cuts long messages and routes so the payload stays within 2KB', () => {
    route = `/${'r'.repeat(300)}`
    reporter.report('あ'.repeat(1000))
    const [event] = api.sent()
    const payload = event === undefined ? {} : event.payload
    expect(payload).toEqual({ message: 'あ'.repeat(500), route: `/${'r'.repeat(99)}` })
    expect(new TextEncoder().encode(JSON.stringify(payload)).length).toBeLessThanOrEqual(2048)
  })

  it('never cuts an emoji in half and keeps the payload within 2KB even when it is all emoji', () => {
    reporter.report('😀'.repeat(600))
    const [event] = api.sent()
    const payload = event === undefined ? {} : event.payload
    const [message = ''] = api.messages().map(String)
    expect(Array.from(message).every((char) => char === '😀')).toBe(true)
    // 500 個（2,000 バイト）なら、キーと画面を足しても 2KB に収まる
    expect(Array.from(message)).toHaveLength(500)
    expect(new TextEncoder().encode(JSON.stringify(payload)).length).toBeLessThanOrEqual(2048)
  })

  it('shrinks messages of control characters, which JSON writes as 6 bytes each', () => {
    reporter.report('\u0001'.repeat(500))
    const [event] = api.sent()
    const payload = event === undefined ? {} : event.payload
    const bytes = new TextEncoder().encode(JSON.stringify(payload)).length
    expect(bytes).toBeLessThanOrEqual(2048)
    // 縮めすぎない（1 文字ぶん足すと超える長さまで残す）
    expect(bytes).toBeGreaterThan(2048 - 6)
  })

  it('replaces a lone surrogate so the JSON column accepts it', () => {
    reporter.report('broken \uD83D end')
    expect(api.messages()).toEqual(['broken � end'])
  })

  it('sends the same message only once within 10 seconds', () => {
    reporter.report('boom')
    time.advance(9_999)
    reporter.report('boom')
    reporter.report('other')
    time.advance(1)
    reporter.report('boom')
    expect(api.messages()).toEqual(['boom', 'other', 'boom'])
  })

  it('sends at most 10 errors a minute', () => {
    for (let i = 0; i < 12; i++) reporter.report(`error ${i}`)
    expect(api.sent()).toHaveLength(10)
    time.advance(60_000)
    reporter.report('after a minute')
    expect(api.messages()).toContain('after a minute')
  })

  it('only warns when sending fails, without throwing', async () => {
    api.failNext()
    expect(() => reporter.report('boom')).not.toThrow()
    await Promise.resolve()
    await Promise.resolve()
    expect(time.warnings()).toEqual([['エラーの記録を送れませんでした', expect.any(Error)]])
  })
})
