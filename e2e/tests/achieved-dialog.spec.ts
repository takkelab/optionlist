import { expect, test } from '@playwright/test'
import { CompletionScreen } from '../support/CompletionScreen'
import { NetworkConditions } from '../support/NetworkConditions'
import { OptionSeed } from '../support/OptionSeed'
import { OptionSheetScreen } from '../support/OptionSheetScreen'
import { MySqlTestData } from '../support/TestData'
import { WishListScreen } from '../support/WishListScreen'

// screens.md §4: 🎉 のあとの移動の確認（写真の枠つき）。docs/decisions/0029
const data = new MySqlTestData()

test.beforeEach(async () => {
  await data.reset()
})

test.afterAll(async () => {
  await data.close()
})

test('Esc は「このまま残す」と同じで、確認だけが閉じてシートは残る', async ({ page, request }) => {
  await new OptionSeed(request).add('登山')
  const list = new WishListScreen(page)
  await list.open()
  const sheet = new OptionSheetScreen(page)
  const completion = new CompletionScreen(page)
  await sheet.openFromCard('登山')
  await completion.achieveUntilAnswer()

  const { keyboard } = page
  await keyboard.press('Escape')
  await expect(completion.moveConfirm()).toBeHidden()
  await expect(sheet.sheet()).toBeVisible()
  await expect(list.titleCells()).toHaveText(['登山'])
})

test('確認を開いたまま戻ると、シートごと閉じて一覧を操作できる', async ({ page, request }) => {
  await new OptionSeed(request).add('温泉')
  const list = new WishListScreen(page)
  await list.open()
  const sheet = new OptionSheetScreen(page)
  const completion = new CompletionScreen(page)
  await sheet.openFromCard('温泉')
  await completion.achieveUntilAnswer()

  await page.goBack()
  await expect(sheet.sheet()).toBeHidden()
  // 見えないモーダルが残っていると、ここが押せない
  await sheet.openFromCard('温泉')
  await expect(sheet.sheet()).toBeVisible()
  await expect(completion.moveConfirm()).toBeHidden()
})

test('写真の保存の間は「保存しています…」と出し、答えられず、Esc でも閉じない', async ({ page, request }) => {
  await new OptionSeed(request).add('写生')
  const list = new WishListScreen(page)
  await list.open()
  const sheet = new OptionSheetScreen(page)
  const completion = new CompletionScreen(page)
  await sheet.openFromCard('写生')
  await completion.achieveUntilAnswer()
  const confirm = completion.moveConfirm()
  const network = new NetworkConditions(page)
  await network.slowDown(1000)

  await completion.pickPhotoFromConfirm()
  await expect(confirm.getByRole('button', { name: '保存しています…' })).toBeDisabled()
  await expect(confirm.getByRole('button', { name: '移動する' })).toBeDisabled()
  await expect(confirm.getByRole('button', { name: 'このまま残す' })).toBeDisabled()
  const { keyboard } = page
  await keyboard.press('Escape')
  await expect(confirm).toBeVisible()

  await expect(completion.confirmPhoto()).toBeVisible()
  await network.restore()
  await expect(confirm.getByRole('button', { name: '移動する' })).toBeEnabled()
})

test('付けた写真を選び直せる。次の 🎉 では枠が空に戻り、写真はその達成に付く', async ({ page, request }) => {
  await new OptionSeed(request).add('ボウリング')
  const list = new WishListScreen(page)
  await list.open()
  const sheet = new OptionSheetScreen(page)
  const completion = new CompletionScreen(page)
  await sheet.openFromCard('ボウリング')
  await completion.achieveUntilAnswer()
  const confirm = completion.moveConfirm()

  await completion.pickPhotoFromConfirm()
  const photo = completion.confirmPhoto()
  await expect(photo).toBeVisible()
  const first = await photo.getAttribute('src')
  await completion.replacePhotoFromConfirm()
  // 選び直しを保存できたら、写真が作り直される
  await expect(photo).not.toHaveAttribute('src', String(first))
  await completion.answerMove(false)
  await expect(completion.historyPhotos()).toHaveCount(1)

  await completion.achieveUntilAnswer()
  await expect(completion.confirmPhoto()).toHaveCount(0)
  await expect(confirm.getByRole('button', { name: '写真を残す' })).toBeVisible()
  await completion.pickPhotoFromConfirm()
  await expect(completion.confirmPhoto()).toBeVisible()
  await completion.answerMove(false)
  await expect(completion.historyPhotos()).toHaveCount(2)
})

test('移動に失敗したらトーストで知らせ、確認に戻って答え直せる', async ({ page, request }) => {
  await new OptionSeed(request).add('乗馬')
  const list = new WishListScreen(page)
  await list.open()
  const sheet = new OptionSheetScreen(page)
  const completion = new CompletionScreen(page)
  await sheet.openFromCard('乗馬')
  await completion.achieveUntilAnswer()
  const network = new NetworkConditions(page)

  await network.goOffline()
  const confirm = completion.moveConfirm()
  const move = confirm.getByRole('button', { name: '移動する' })
  await move.click()
  await expect(page.getByText('やったリストに移せませんでした')).toBeVisible()
  await expect(confirm).toBeVisible()

  await network.restore()
  await completion.answerMove(true)
  await expect(sheet.sheet()).toBeHidden()
  await expect(page.getByText('『乗馬』をやったリストに移しました')).toBeVisible()
})

test('演出の途中でシートを閉じたら、演出の時間が過ぎても確認は残らず、一覧を操作できる', async ({ page, request }) => {
  await new OptionSeed(request).add('キャンプ')
  const list = new WishListScreen(page)
  await list.open()
  const sheet = new OptionSheetScreen(page)
  const completion = new CompletionScreen(page)
  await sheet.openFromCard('キャンプ')
  await completion.achieve()
  await expect(completion.message()).toBeVisible()
  await sheet.close()
  // 演出の 1.5 秒が過ぎるまで待つ（閉じたシートの中の確認は見えないので、見た目では待てない）
  await page.waitForTimeout(1700)

  // 見えないモーダルが残っていると、ここが押せない
  await sheet.openFromCard('キャンプ')
  await expect(sheet.sheet()).toBeVisible()
  await expect(completion.moveConfirm()).toBeHidden()
})
