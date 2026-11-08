export interface PraiseSource {
  // 🎉 を押す前の達成回数から、出す労いメッセージを決める
  for(countBefore: number): string
}

// 🎉 のあとに出す労いメッセージ（screens.md §4、docs/decisions/0018）。初めての 🎉 と 2 回目以降で出し分ける
// 1 行は 12 文字まで。それより長いものは、言葉の切れ目に \n を書いて折り返す（幅 360px で 1 行に入るのが約 12 文字。
// ブラウザに任せると言葉の途中で折り返し、文節で折り返す CSS は iPhone の Safari が対応していない）
export const PRAISE_LINE_MAX = 12

export const PRAISES = {
  first: '新しい体験が\nひとつ増えたね',
  repeat: '同じことでも\n毎回ちがう体験だね',
} as const

export class PraiseMessages implements PraiseSource {
  for(countBefore: number): string {
    return countBefore === 0 ? PRAISES.first : PRAISES.repeat
  }
}
