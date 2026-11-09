import type { OptionStatus, SuggestionCatalog } from '../../../shared/types'
import type { SuggestionsApi } from '../api/client'

export interface CatalogLoader {
  // 最近読んだ提案の一覧。まだ読んでいなければ null
  cached(): SuggestionCatalog | null
  // 読み直す（読んだものを覚える）。読んでいる間に付けた印は、届いた一覧にも付けて返す
  load(): Promise<SuggestionCatalog>
  // 提案 1 件を読んだとき・追加したときに、覚えている一覧の印（追加済み・やった）をそれに合わせる
  mark(id: number, status: OptionStatus | null): void
  // 覚えている一覧と印を捨てる（アカウントが入れ替わったとき。前のアカウントの印を出さない）。それより前に読み始めたものでは埋めない
  forget(): void
}

type Mark = { seq: number; id: number; status: OptionStatus | null }

// 提案の一覧を覚えておく。提案 1 件やタグの一覧から戻ったとき、読み込みを待たずに出して、離れたときのスクロール位置に戻せるようにする（screens.md §5）
// 覚えた一覧を出したあとも、画面を開くたびに読み直す（別の端末での追加や、やりたいリストでの削除を反映する）
// 読み込みと印は、起きた順番（seq）で古い・新しいを決める。後から読み始めたものが先に届いていたら、先に読み始めたもので上書きしない。
// 読んでいる間に付けた印は、届いた一覧が古い状態でも消さない（追加した直後に、読み込み中だった探す画面の結果で「追加済み」が外れないように）
export class CatalogCache implements CatalogLoader {
  readonly #api: SuggestionsApi
  #catalog: SuggestionCatalog | null = null
  // 覚えている一覧を読み始めた seq
  #catalogSeq = 0
  #seq = 0
  // 読み込み中に付けた印を、届いた一覧に付け直すために覚えておく
  #marks: Mark[] = []

  constructor(api: SuggestionsApi) {
    this.#api = api
  }

  cached(): SuggestionCatalog | null {
    return this.#catalog
  }

  async load(): Promise<SuggestionCatalog> {
    this.#seq += 1
    const started = this.#seq
    const loaded = await this.#api.catalog()
    const catalog = this.#marks.filter((m) => m.seq > started).reduce((c, m) => this.#marked(c, m.id, m.status), loaded)
    if (started > this.#catalogSeq) {
      this.#catalog = catalog
      this.#catalogSeq = started
    }
    // 覚えている一覧より前の印は、もう付け直さない
    this.#marks = this.#marks.filter((m) => m.seq > this.#catalogSeq)
    // 追い越された古い読み込みは、新しいほうを返す
    return this.#catalog ?? catalog
  }

  mark(id: number, status: OptionStatus | null): void {
    this.#seq += 1
    this.#marks.push({ seq: this.#seq, id, status })
    if (this.#catalog !== null) this.#catalog = this.#marked(this.#catalog, id, status)
  }

  forget(): void {
    this.#seq += 1
    this.#catalog = null
    this.#catalogSeq = this.#seq
    this.#marks = []
  }

  // 状態が変わらなければ同じ一覧を返す（探す画面が同じ一覧を描き直さないように）
  #marked(catalog: SuggestionCatalog, id: number, status: OptionStatus | null): SuggestionCatalog {
    const { suggestions } = catalog
    if (!suggestions.some((s) => s.id === id && s.optionStatus !== status)) return catalog
    return { ...catalog, suggestions: suggestions.map((s) => (s.id === id ? { ...s, optionStatus: status } : s)) }
  }
}
