import type { Locator } from '@playwright/test'

export type Edges = { left: number; right: number }

export interface LayoutReader {
  edges(locator: Locator): Promise<Edges>
  customProperty(locator: Locator, name: string): Promise<string>
}

// 画面の配置と CSS の変数を読む（screens.md §1 の列の幅・テーマの色を確かめる）
export class LayoutProbe implements LayoutReader {
  // 要素の左端と右端（px）
  async edges(locator: Locator): Promise<Edges> {
    const box = await locator.boundingBox()
    if (box === null) throw new Error('要素が見えていない')
    return { left: box.x, right: box.x + box.width }
  }

  // 要素に効いている CSS の変数の値（なければ空文字）
  async customProperty(locator: Locator, name: string): Promise<string> {
    const value = await locator.evaluate((el, prop) => getComputedStyle(el).getPropertyValue(prop), name)
    return value.trim()
  }
}
