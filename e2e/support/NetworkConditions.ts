import type { CDPSession, Page } from '@playwright/test'

export interface NetworkControls {
  // 応答を遅らせる（保存している間の画面を確かめる）
  slowDown(latencyMs: number): Promise<void>
  goOffline(): Promise<void>
  restore(): Promise<void>
}

// ブラウザの通信の状態を変える。応答は差し替えないので、届けば本物の backend が答える（testing.md §5）
export class NetworkConditions implements NetworkControls {
  readonly #page: Page
  // 設定はセッションごとに持たれるので、戻すときも同じセッションで行う
  #session: CDPSession | null = null

  constructor(page: Page) {
    this.#page = page
  }

  async slowDown(latencyMs: number): Promise<void> {
    await this.#emulate(false, latencyMs)
  }

  async goOffline(): Promise<void> {
    await this.#emulate(true, 0)
  }

  async restore(): Promise<void> {
    await this.#emulate(false, 0)
  }

  async #emulate(offline: boolean, latency: number): Promise<void> {
    if (this.#session === null) {
      const context = this.#page.context()
      this.#session = await context.newCDPSession(this.#page)
      await this.#session.send('Network.enable')
    }
    await this.#session.send('Network.emulateNetworkConditions', { offline, latency, downloadThroughput: -1, uploadThroughput: -1 })
  }
}
