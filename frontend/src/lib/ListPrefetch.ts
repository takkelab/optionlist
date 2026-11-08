import type { Option, OptionStatus } from '../../../shared/types'
import type { OptionsApi } from '../api/client'

export interface ListLoader {
  // 一覧を読み始めておく（画面を開いたときにもう片方の一覧を、「やりたいこと｜やったこと」に指が触れたときに先の一覧を）
  prefetch(status: OptionStatus): void
  // 最近読んだ一覧。画面を開いたらまずこれを出し、load の結果で置き換える。読んでいない・古すぎるなら null
  cached(status: OptionStatus): Option[] | null
  // 一覧を読む。読み始めておいたものがあれば、それを使う
  load(status: OptionStatus): Promise<Option[]>
  // 画面で書き換えた一覧（追加・削除・予定日など）を、最近読んだ一覧として覚える
  remember(status: OptionStatus, list: Option[]): void
  // 覚えている一覧を捨てる（別の一覧から項目を移したとき。古い中身を出さず、次は読み込みを待つ）
  forget(status: OptionStatus): void
}

// 読み始めておいたものを load で使う期限。指が触れたまま押さなかったときは、古くならないうちに捨てる
const PREFETCH_MAX_AGE_MS = 2000
// 最近読んだ一覧をすぐ出す期限。長く開いていなかった一覧は、古い中身を出さずに読み込みを待つ
const CACHE_MAX_AGE_MS = 60_000

type Read = { list: Promise<Option[]>; at: number }
// list が null なら、その時刻に捨てた（それより前に読み始めた結果では埋めない）
type Loaded = { list: Option[] | null; at: number }

// 切り替えを押してから動き出すまでの待ち（切り替えた先の一覧の読み込み。lib/PageSlide.ts）をなくすため（docs/decisions/0019）、
// - 画面を開いたときにもう片方の一覧を裏で読んでおき、切り替えた先の画面はそれをすぐ出す（読み込みを待たずに滑らせられる）
// - 指が触れた瞬間（離す前）にも読み直し、届いたら新しい中身に置き換える（直前にシートで移した項目なども出る）
export class ListPrefetch implements ListLoader {
  readonly #api: OptionsApi
  readonly #now: () => number
  readonly #reading = new Map<OptionStatus, Read>()
  readonly #loaded = new Map<OptionStatus, Loaded>()

  constructor(api: OptionsApi, now: () => number = Date.now) {
    this.#api = api
    this.#now = now
  }

  prefetch(status: OptionStatus): void {
    const list = this.#read(status)
    // 使われずに失敗しても、未処理の失敗にしない（使ったときは、使った側が失敗を知らせる）
    list.then(undefined, (error: unknown) => console.warn('一覧の先読みに失敗しました', error))
    this.#reading.set(status, { list, at: this.#now() })
  }

  cached(status: OptionStatus): Option[] | null {
    const loaded = this.#loaded.get(status)
    return loaded !== undefined && this.#now() - loaded.at <= CACHE_MAX_AGE_MS ? loaded.list : null
  }

  // 読み始めておいたものは期限の間だけ使う。1 回で捨てないのは、開発中の StrictMode が画面を開くときの読み込みを 2 回走らせるため
  // （1 回目は捨てられるので、使い切りだと 2 回目が読み直しになる）
  load(status: OptionStatus): Promise<Option[]> {
    const reading = this.#reading.get(status)
    if (reading !== undefined && this.#now() - reading.at <= PREFETCH_MAX_AGE_MS) return reading.list
    this.#reading.delete(status)
    return this.#read(status)
  }

  remember(status: OptionStatus, list: Option[]): void {
    this.#loaded.set(status, { list, at: this.#now() })
  }

  forget(status: OptionStatus): void {
    this.#loaded.set(status, { list: null, at: this.#now() })
  }

  // 読み終わったら、最近読んだ一覧として覚える（読み始めた時刻で古さを測り、後から届いた古い結果では上書きしない）。
  // 失敗は返す Promise のまま呼んだ側に届く
  async #read(status: OptionStatus): Promise<Option[]> {
    const at = this.#now()
    const list = await this.#api.list(status)
    const known = this.#loaded.get(status)
    if (known === undefined || known.at <= at) this.#loaded.set(status, { list, at })
    return list
  }
}
