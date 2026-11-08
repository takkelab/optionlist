import type { EventsApi } from '../api/client'

export interface ErrorReporter {
  // 起きたエラーを client_error として送る（screens.md §8）。text はトーストの文言など、エラーに添える説明
  report(error: unknown, text?: string): void
}

// 同じメッセージはこの間に続いたら 1 回だけ送る
const SAME_MESSAGE_MS = 10_000
// 1 分に送る件数の上限（エラーが繰り返し起きても DB を埋めない）
const LIMIT_WINDOW_MS = 60_000
const LIMIT_PER_WINDOW = 10
// payload は JSON で 2KB まで（data.md §3）。メッセージは 500 文字（コードポイント）で切り、それでも超えたら（絵文字・制御文字が多いとき）さらに縮める
const MESSAGE_MAX = 500
const ROUTE_MAX = 100
const PAYLOAD_MAX_BYTES = 2048
const encoder = new TextEncoder()

// 画面で起きたエラーを backend に送る。送信の失敗は warn に出すだけで、トーストも client_error も出さない（自分の失敗でまた送らない）
export class ClientErrorReporter implements ErrorReporter {
  readonly #api: EventsApi
  readonly #route: () => string
  readonly #now: () => number
  readonly #warn: (message: string, error: unknown) => void
  // メッセージごとに最後に送った時刻
  readonly #lastSent = new Map<string, number>()
  #sentTimes: number[] = []

  constructor(
    api: EventsApi,
    route: () => string,
    now: () => number = Date.now,
    warn: (message: string, error: unknown) => void = console.warn,
  ) {
    this.#api = api
    this.#route = route
    this.#now = now
    this.#warn = warn
  }

  report(error: unknown, text?: string): void {
    const detail = this.#describe(error)
    const payload = this.#fit(text === undefined ? detail : `${text}: ${detail}`, this.#route())
    const at = this.#now()
    if (!this.#allow(payload.message, at)) return
    const event = { type: 'client_error' as const, payload, occurredAt: new Date(at).toISOString() }
    this.#api.send([event]).catch((failure: unknown) => this.#warn('エラーの記録を送れませんでした', failure))
  }

  // コードポイントで切る（絵文字を半分にしない）。片割れのサロゲートは JSON の DB が弾くので U+FFFD に置き換える
  #fit(message: string, route: string): { message: string; route: string } {
    const chars = this.#wellFormed(message).slice(0, MESSAGE_MAX)
    const cut = { message: chars.join(''), route: this.#wellFormed(route).slice(0, ROUTE_MAX).join('') }
    while (encoder.encode(JSON.stringify(cut)).length > PAYLOAD_MAX_BYTES) {
      chars.pop()
      cut.message = chars.join('')
    }
    return cut
  }

  #wellFormed(value: string): string[] {
    return Array.from(value, (char) => (char.length === 1 && char >= '\uD800' && char <= '\uDFFF' ? '�' : char))
  }

  #allow(message: string, at: number): boolean {
    for (const [known, sentAt] of this.#lastSent) {
      if (at - sentAt >= SAME_MESSAGE_MS) this.#lastSent.delete(known)
    }
    this.#sentTimes = this.#sentTimes.filter((sentAt) => at - sentAt < LIMIT_WINDOW_MS)
    if (this.#lastSent.has(message) || this.#sentTimes.length >= LIMIT_PER_WINDOW) return false
    this.#lastSent.set(message, at)
    this.#sentTimes.push(at)
    return true
  }

  #describe(error: unknown): string {
    if (error instanceof Error) return `${error.name}: ${error.message}`
    if (typeof error === 'string') return error
    try {
      return JSON.stringify(error) ?? String(error)
    } catch (failure) {
      // 循環参照などで JSON にできないものは、String にしたもの（[object Object] など）を残す
      this.#warn('エラーを文字列にできませんでした', failure)
      return String(error)
    }
  }
}
