import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { Page } from '@playwright/test'
import type { UiMetrics } from '../../scripts/lib/e2e-collector.ts'

export type SmallTapTarget = UiMetrics['smallTapTargets'][number]

export interface UiMeasurer {
  lcpSec(page: Page): Promise<number>
  smallTapTargets(page: Page, screen: string): Promise<SmallTapTarget[]>
  save(metrics: UiMetrics): void
}

// metrics.md §3 のタップ領域の下限
const MIN_TAP_PX = 44
// scripts/lib/e2e-collector.ts（npm run metrics:check）が読む
const OUTPUT = resolve(import.meta.dirname, '../results/ui-metrics.json')

// metrics.md §3 の LCP とタップ領域を、ブラウザの中で測る
export class UiProbe implements UiMeasurer {
  // 読み込みが終わった画面の LCP（秒）。PerformanceObserver の buffered で、すでに出た値を読む
  async lcpSec(page: Page): Promise<number> {
    const ms = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const observer = new PerformanceObserver((list) => {
            const last = list.getEntries().at(-1)
            resolve(last === undefined ? 0 : last.startTime)
          })
          observer.observe({ type: 'largest-contentful-paint', buffered: true })
        }),
    )
    return Math.round(ms) / 1000
  }

  // 見えているボタン・リンク・入力欄のうち、44×44px に満たないもの
  async smallTapTargets(page: Page, screen: string): Promise<SmallTapTarget[]> {
    // 開いたばかりのダイアログは少し小さい状態から出る（screens.md §1）ので、動きが終わってから測る
    await page.evaluate(async () => {
      const running = document.getAnimations()
      await Promise.allSettled(running.map((animation) => animation.finished))
    })
    const targets = await page.evaluate(() =>
      [...document.querySelectorAll('a, button, input, textarea, [role="button"]')].flatMap((element) => {
        const rect = element.getBoundingClientRect()
        if (rect.width === 0 && rect.height === 0) return []
        const name = element.getAttribute('aria-label') ?? element.textContent ?? ''
        return [{ element: `${element.localName}「${name.trim()}」`, width: rect.width, height: rect.height }]
      }),
    )
    return targets
      .filter((t) => t.width < MIN_TAP_PX || t.height < MIN_TAP_PX)
      .map((t) => ({ screen, element: t.element, width: Math.round(t.width), height: Math.round(t.height) }))
  }

  save(metrics: UiMetrics): void {
    mkdirSync(dirname(OUTPUT), { recursive: true })
    writeFileSync(OUTPUT, `${JSON.stringify(metrics, null, 2)}\n`)
  }
}
