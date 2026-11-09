export interface CodeFormatter {
  // 入力欄に出す形（大文字にし、4 文字ごとにハイフンを入れる。16 文字まで）
  display(input: string): string
  // 16 文字そろったか
  complete(input: string): boolean
}

const LENGTH = 16
const GROUP = 4

// 復旧コードの入力欄（screens.md §9）。区切りと見分けにくい文字はサーバーが正規化して確かめる（data.md §3）ので、
// ここでは英数字だけを残して並べ直す
export class RecoveryCodeFormat implements CodeFormatter {
  display(input: string): string {
    const chars = this.#chars(input).slice(0, LENGTH)
    const groups: string[] = []
    for (let i = 0; i < chars.length; i += GROUP) groups.push(chars.slice(i, i + GROUP))
    return groups.join('-')
  }

  complete(input: string): boolean {
    return this.#chars(input).length === LENGTH
  }

  #chars(input: string): string {
    return input.toUpperCase().replace(/[^0-9A-Z]/g, '')
  }
}
