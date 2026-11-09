// 通信できないとき（オフライン）の失敗の文言（screens.md §7）
export const OFFLINE_MESSAGE = '通信できませんでした。電波のよいところでもう一度お試しください'

export interface FailureMessageRule {
  // トーストに出す文言。通信できないときは、何の失敗でもオフラインの文言にする
  toastText(failure: string): string
}

// オンラインかは関数で受け取る（画面では navigator.onLine。テストでは固定する）。
// 通信できないと、API の失敗の理由（読み込めない・保存できない）を分けても、利用者にできることは同じ（電波のよいところで試し直す）なので 1 つにまとめる
export class FailureMessage implements FailureMessageRule {
  readonly #isOnline: () => boolean

  constructor(isOnline: () => boolean) {
    this.#isOnline = isOnline
  }

  toastText(failure: string): string {
    return this.#isOnline() ? failure : OFFLINE_MESSAGE
  }
}
