// 端末に覚えておく小さな値（localStorage）。使えないブラウザ（プライベートの窓・保存を止めた設定）では、覚えていないものとして動く
export interface KeyValueStore {
  get(key: string): string | null
  set(key: string, value: string): void
  remove(key: string): void
}

// 読めない・書けないときは、画面は止めずに console.warn に出す（握り潰さない。覚えられないと、勧めるカードがもう一度出るだけ）
export class BrowserStore implements KeyValueStore {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key)
    } catch (error) {
      console.warn(`端末に覚えた値（${key}）を読めませんでした`, error)
      return null
    }
  }

  set(key: string, value: string): void {
    try {
      localStorage.setItem(key, value)
    } catch (error) {
      console.warn(`端末に値（${key}）を覚えられませんでした`, error)
    }
  }

  remove(key: string): void {
    try {
      localStorage.removeItem(key)
    } catch (error) {
      console.warn(`端末に覚えた値（${key}）を消せませんでした`, error)
    }
  }
}

// screens.md §9 で端末に覚えるもの
export interface AccountMemo {
  // 写真を初めて保存したか（復旧コードを勧めるきっかけ）
  photoSaved(): boolean
  markPhotoSaved(): void
  // 勧めるカードに [控える] か [あとで] で答えたか（どちらでも二度と出さない）
  promptAnswered(): boolean
  answerPrompt(): void
  // 引き継いで使ったコードが消えたので、新しいコードを控えてほしいか（シートの「機種変更に備える」の印）
  needsNewCode(): boolean
  setNeedsNewCode(needs: boolean): void
}

const KEYS = { photoSaved: 'ol.photoSaved', promptAnswered: 'ol.recoveryPromptAnswered', needsNewCode: 'ol.needsNewCode' } as const

export class AccountMemory implements AccountMemo {
  readonly #store: KeyValueStore

  constructor(store: KeyValueStore) {
    this.#store = store
  }

  photoSaved(): boolean {
    return this.#store.get(KEYS.photoSaved) === '1'
  }

  markPhotoSaved(): void {
    this.#store.set(KEYS.photoSaved, '1')
  }

  promptAnswered(): boolean {
    return this.#store.get(KEYS.promptAnswered) === '1'
  }

  answerPrompt(): void {
    this.#store.set(KEYS.promptAnswered, '1')
  }

  needsNewCode(): boolean {
    return this.#store.get(KEYS.needsNewCode) === '1'
  }

  setNeedsNewCode(needs: boolean): void {
    if (needs) this.#store.set(KEYS.needsNewCode, '1')
    else this.#store.remove(KEYS.needsNewCode)
  }
}
