export interface TitleValidator {
  // 送ってよいタイトルなら前後の空白を除いた値、だめなら null
  normalize(input: string): string | null
}

const TITLE_MAX = 200

// backend の controllers/OptionInput.ts と同じ規則: 前後の空白（全角スペースを含む）を除いて 1〜200 文字。絵文字も 1 文字に数える
export class TitleRule implements TitleValidator {
  normalize(input: string): string | null {
    const title = input.trim()
    const { length } = [...title]
    return length >= 1 && length <= TITLE_MAX ? title : null
  }
}
