export interface AchievementFormatter {
  // カードに出す達成回数。0 回なら null（何も出さない）
  format(count: number): string | null
}

// screens.md §2: 1 回以上のときだけ「🎉×3」のように出す
export class AchievementLabel implements AchievementFormatter {
  format(count: number): string | null {
    return count >= 1 ? `🎉×${count}` : null
  }
}
