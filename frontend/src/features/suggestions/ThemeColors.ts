import { SuggestionLabels } from '../../lib/SuggestionLabels'
import styles from './ThemeColor.module.css'

const labels = new SuggestionLabels()

export interface ThemeColorClasses {
  // テーマの色のクラス（--theme-color を決める）。カード・行・見出しの丸に付ける
  classOf(themeId: number): string
  // 見出しの横の小さな丸。classOf を付けた要素の中に置く
  dot(): string
}

// テーマの色を CSS のクラスで当てる（docs/decisions/0024）
export class ThemeColors implements ThemeColorClasses {
  classOf(themeId: number): string {
    return styles[`c${labels.colorSlot(themeId)}`] ?? ''
  }

  dot(): string {
    return styles.dot ?? ''
  }
}
