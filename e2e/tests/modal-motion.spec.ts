import { expect, test } from '@playwright/test'
import { OptionSeed } from '../support/OptionSeed'
import { OptionSheetScreen } from '../support/OptionSheetScreen'
import { PgTestData } from '../support/TestData'
import { WishListScreen } from '../support/WishListScreen'

// screens.md §1 のモーダルの出方と消え方（docs/decisions/0016）。持ち手の動きは option-sheet.spec.ts
const data = new PgTestData()

test.beforeEach(async () => {
  await data.reset()
})

test.afterAll(async () => {
  await data.close()
})

test('シートと中央のダイアログ（追加・AI に相談・削除の確認）は動いて出るが、視差効果を減らす設定では動かさない', async ({ page, request }) => {
  await new OptionSeed(request).add('朝日を見に行く')
  const list = new WishListScreen(page)
  const sheet = new OptionSheetScreen(page)
  const { keyboard } = page
  // それぞれに付いている CSS の動きの名前（CSS Modules で前後に文字が付く）。動かさないときは none
  const motions = async (sheetMotion: RegExp | string, dialogMotion: RegExp | string) => {
    await list.open()
    const adding = await list.openAddDialog()
    await expect(adding).toHaveCSS('animation-name', dialogMotion)
    await keyboard.press('Escape')
    await expect(adding).toBeHidden()
    const opened = await sheet.openFromCard('朝日を見に行く')
    await expect(opened).toHaveCSS('animation-name', sheetMotion)
    const consult = await sheet.openConsult()
    await expect(consult).toHaveCSS('animation-name', dialogMotion)
    await keyboard.press('Escape')
    await expect(consult).toBeHidden()
    const confirm = await sheet.openDeleteConfirm()
    await expect(confirm).toHaveCSS('animation-name', dialogMotion)
    await keyboard.press('Escape')
    await expect(confirm).toBeHidden()
    await sheet.close()
  }
  await motions(/slide-up/, /pop-in/)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await motions('none', 'none')
})
