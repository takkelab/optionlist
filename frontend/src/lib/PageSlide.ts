// 画面の切り替えを左右に滑らせる場所（ブラウザでは document。テストではフェイク）
export interface TransitionHost {
  // View Transitions があり、視差効果を減らす設定でもないとき true
  canAnimate(): boolean
  // 滑る向きを CSS に渡す。null で消す
  setDirection(side: string | null): void
  // update の前後の見た目を撮って動かし、動き終わったら resolve する。update が返す Promise が終わるまで、後の見た目は撮らない
  transition(update: () => Promise<void>): Promise<void>
  // 切り替えた先の中身（selector に当たる要素）が描かれるまで待つ。読み込みが遅くても、決めた時間がたてば待つのをやめる
  ready(selector: string): Promise<void>
}

export interface Slider {
  // 滑らせて切り替えたら true。動かせないとき（呼んだ側が今までどおり切り替える）は false。
  // 後の見た目は、readySelector に当たる要素が出てから撮る
  slide(side: string, update: () => void, readySelector: string): boolean
}

// 画面の切り替えを左右に滑らせる。
// - screens.md §1: 「やりたいこと｜やったこと」を押したときに、一覧を左右に滑らせて入れ替える（docs/decisions/0019）
// - screens.md §5: 提案の画面で、進むと右から入り、［‹］で戻ると左から戻る（docs/decisions/0026）
// 中身は画面を開いてから読み込むので、読み込みを待ってから後の見た目を撮る（中身も一緒に滑ってくるように）。
// 動いている間にもう一度切り替えると前の動きは打ち切られて終わるので、向きを消すのは最後の切り替えが終わったときだけにする
export class PageSlide implements Slider {
  readonly #host: TransitionHost
  // 何回目の切り替えか
  #round = 0

  constructor(host: TransitionHost) {
    this.#host = host
  }

  slide(side: string, update: () => void, readySelector: string): boolean {
    if (!this.#host.canAnimate()) return false
    this.#round += 1
    const round = this.#round
    this.#host.setDirection(side)
    const switched = async () => {
      update()
      await this.#host.ready(readySelector)
    }
    void this.#host.transition(switched).finally(() => {
      if (round === this.#round) this.#host.setDirection(null)
    })
    return true
  }
}

// 中身の読み込みを待つ長さ。ふだんは数十ミリ秒で終わる。遅いときは待たずに滑らせ、中身は後から出る
const READY_TIMEOUT_MS = 300

// ブラウザの View Transitions。向きは <html> の data-switch-to で global.css に渡す
export class DocumentTransitionHost implements TransitionHost {
  canAnimate(): boolean {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    return 'startViewTransition' in document && !reduced.matches
  }

  setDirection(side: string | null): void {
    const { dataset } = document.documentElement
    if (side === null) delete dataset.switchTo
    else dataset.switchTo = side
  }

  transition(update: () => Promise<void>): Promise<void> {
    const { finished } = document.startViewTransition(update)
    return finished
  }

  // 切り替えの間は画面の描画が止まる（requestAnimationFrame も呼ばれない）ので、DOM の変化を MutationObserver で見る
  ready(selector: string): Promise<void> {
    return new Promise((resolve) => {
      if (document.querySelector(selector) !== null) {
        resolve()
        return
      }
      const done = () => {
        observer.disconnect()
        clearTimeout(timer)
        resolve()
      }
      const observer = new MutationObserver(() => {
        if (document.querySelector(selector) !== null) done()
      })
      const timer = setTimeout(done, READY_TIMEOUT_MS)
      observer.observe(document.body, { childList: true, subtree: true, attributes: true })
    })
  }
}
