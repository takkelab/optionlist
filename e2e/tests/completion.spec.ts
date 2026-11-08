import { expect, test } from '@playwright/test'
import { CompletionScreen } from '../support/CompletionScreen'
import { OptionSeed } from '../support/OptionSeed'
import { OptionSheetScreen } from '../support/OptionSheetScreen'
import { MySqlTestData } from '../support/TestData'
import { WishListScreen } from '../support/WishListScreen'

// screens.md §4・§6: 🎉 → 労いの演出 → 移動の確認、やったリスト、やりたいリストに戻す。testing.md §5 のシナリオ 2・3・8
const data = new MySqlTestData()

test.beforeEach(async () => {
  await data.reset()
})

test.afterAll(async () => {
  await data.close()
})

test('手動で追加 → シートで 🎉 → 労いの演出 → 「移動する」→ やったリストに出る', async ({ page }) => {
  const list = new WishListScreen(page)
  await list.open()
  await list.add('富士山に登る')
  await list.add('陶芸をする')
  const sheet = new OptionSheetScreen(page)
  const completion = new CompletionScreen(page)
  await sheet.openFromCard('富士山に登る')
  await completion.achieve()
  await expect(completion.confetti()).toHaveCount(16)
  // 演出は押さなくても 1.5 秒ほどで消え、移動の確認が出る
  const message = completion.message()
  await expect(message).toBeVisible()
  await expect(message).toBeHidden()
  await expect(completion.photoPrompt()).toBeHidden()
  await completion.answerMove(true)

  await expect(sheet.sheet()).toBeHidden()
  await expect(page.getByText('『富士山に登る』をやったリストに移しました')).toBeVisible()
  await expect(list.titleCells()).toHaveText(['陶芸をする'])

  await list.showDone()
  await expect(list.titleCells()).toHaveText(['富士山に登る'])
  const card = page.getByRole('listitem').filter({ hasText: '富士山に登る' })
  await expect(card).toContainText('🎉×1')
  await expect(card).toContainText(/\d+月\d+日に移動/)
})

test('🎉 → 「このまま残す」→ やりたいリストに残り、達成回数と達成した日が出る', async ({ page, request }) => {
  await new OptionSeed(request).add('ボルダリング')
  const list = new WishListScreen(page)
  await list.open()
  const sheet = new OptionSheetScreen(page)
  const completion = new CompletionScreen(page)
  await sheet.openFromCard('ボルダリング')
  await completion.achieve()
  // 初めての 🎉 と 2 回目以降で労いメッセージを出し分ける（screens.md §4）
  // 文言の改行は、比べるときに空白になる
  await expect(completion.message()).toHaveText(/^新しい体験が\s*ひとつ増えたね$/)
  await completion.skipCelebration()
  await completion.answerMove(false)

  await expect(sheet.sheet()).toContainText('🎉×1')
  // 日付は端末の今日（テストが日付をまたいでもよいよう、形だけを見る）
  await expect(completion.history()).toHaveText([/^\d{4}\/\d{1,2}\/\d{1,2}（[日月火水木金土]）$/])
  await completion.achieve()
  await expect(completion.message()).toHaveText(/^同じことでも\s*毎回ちがう体験だね$/)
  await completion.skipCelebration()
  await completion.answerMove(false)
  await expect(completion.history()).toHaveCount(2)
  await sheet.close()

  await list.open()
  await expect(list.titleCells()).toHaveText(['ボルダリング'])
  await expect(page.getByRole('listitem').filter({ hasText: 'ボルダリング' })).toContainText('🎉×2')
})

test('やったリストから「やりたいリストに戻す」と、やったリストから消えてやりたいリストに出る', async ({ page, request }) => {
  const seed = new OptionSeed(request)
  await seed.complete(await seed.add('スキューバダイビング'))
  await page.goto('/done')
  const list = new WishListScreen(page)
  await list.waitUntilLoaded()
  const sheet = new OptionSheetScreen(page)
  const completion = new CompletionScreen(page)
  await sheet.openFromCard('スキューバダイビング')
  await completion.backToWish()

  await expect(page.getByText('『スキューバダイビング』をやりたいリストに戻しました')).toBeVisible()
  await expect(page.getByText('🎉 を押して、やったことをここに集めよう')).toBeVisible()
  await list.showWish()
  await expect(list.titleCells()).toHaveText(['スキューバダイビング'])
})

test('🎉 のあとに写真を付けると、やったリストで見え、シートで付け替え・削除できる', async ({ page, request }) => {
  await new OptionSeed(request).add('陶芸')
  const list = new WishListScreen(page)
  await list.open()
  const sheet = new OptionSheetScreen(page)
  const completion = new CompletionScreen(page)
  await sheet.openFromCard('陶芸')
  await completion.achieve()
  await completion.skipCelebration()
  await completion.pickPhotoFromConfirm()
  // 保存が終わると、確認に写真が出る
  await expect(completion.confirmPhoto()).toBeVisible()
  await completion.answerMove(true)

  await list.showDone()
  const card = page.getByRole('listitem').filter({ hasText: '陶芸' })
  const photo = card.locator('img')
  await expect(photo).toHaveJSProperty('complete', true)
  const first = await photo.getAttribute('src')
  expect(first).toMatch(/^\/api\/photos\/.+\.jpg$/)

  await sheet.openFromCard('陶芸')
  await expect(completion.historyPhotos()).toHaveCount(1)
  await completion.pickPhotoFromHistory('付け替える')
  await expect(completion.historyPhotos()).not.toHaveAttribute('src', String(first))

  await completion.removePhoto()
  await expect(completion.historyPhotos()).toHaveCount(0)
  await expect(completion.historyButton('写真を付ける')).toBeVisible()
  await sheet.close()
  await expect(card.locator('img')).toHaveCount(0)
})

test('移動の確認で写真を付けて「このまま残す」と、シートの達成した日に写真が出る', async ({ page, request }) => {
  await new OptionSeed(request).add('ピクニック')
  const list = new WishListScreen(page)
  await list.open()
  const sheet = new OptionSheetScreen(page)
  const completion = new CompletionScreen(page)
  await sheet.openFromCard('ピクニック')
  await completion.achieve()
  await completion.skipCelebration()
  await completion.pickPhotoFromConfirm()
  await expect(completion.confirmPhoto()).toBeVisible()
  await completion.answerMove(false)

  await expect(completion.historyPhotos()).toHaveCount(1)
  await expect(list.titleCells()).toHaveText(['ピクニック'])
})

test('移動の確認で読めないファイルを選ぶと、トーストで知らせて確認に残り、写真は付かない', async ({ page, request }) => {
  await new OptionSeed(request).add('釣り')
  const list = new WishListScreen(page)
  await list.open()
  const sheet = new OptionSheetScreen(page)
  const completion = new CompletionScreen(page)
  await sheet.openFromCard('釣り')
  await completion.achieve()
  await completion.skipCelebration()
  await completion.pickBrokenPhotoFromConfirm()

  await expect(page.getByText('この写真は読み込めませんでした。別の写真を選んでください')).toBeVisible()
  await expect(completion.confirmPhoto()).toHaveCount(0)
  await completion.answerMove(false)
  await expect(completion.historyPhotos()).toHaveCount(0)
})

test('写真を付けなかった達成に、あとからシートで写真を付けられる', async ({ page, request }) => {
  const seed = new OptionSeed(request)
  await seed.complete(await seed.add('フルマラソン'))
  await page.goto('/done')
  const sheet = new OptionSheetScreen(page)
  const completion = new CompletionScreen(page)
  await sheet.openFromCard('フルマラソン')
  await completion.achieve()
  await completion.skipCelebration()
  await completion.skipPhoto()

  await completion.pickPhotoFromHistory('写真を付ける')
  await expect(completion.historyPhotos()).toHaveCount(1)
  await sheet.close()
  const card = page.getByRole('listitem').filter({ hasText: 'フルマラソン' })
  await expect(card.locator('img')).toHaveCount(1)
})

test('ファイルの選択を閉じても、シートは閉じない。移動の確認はそのまま残る', async ({ page, request }) => {
  await new OptionSeed(request).add('登山')
  const list = new WishListScreen(page)
  await list.open()
  const sheet = new OptionSheetScreen(page)
  const completion = new CompletionScreen(page)
  await sheet.openFromCard('登山')
  await completion.achieve()
  await completion.skipCelebration()
  await completion.cancelPicking('confirm')
  await expect(sheet.sheet()).toBeVisible()
  await expect(completion.moveConfirm()).toBeVisible()
  await completion.answerMove(false)

  await completion.cancelPicking('history')
  await expect(sheet.sheet()).toBeVisible()
  await expect(completion.historyButton('写真を付ける')).toBeEnabled()
})

test('画像として読めないファイルを選ぶと、トーストで知らせて写真は付かない', async ({ page, request }) => {
  const seed = new OptionSeed(request)
  await seed.complete(await seed.add('読書'))
  await page.goto('/done')
  const sheet = new OptionSheetScreen(page)
  const completion = new CompletionScreen(page)
  await sheet.openFromCard('読書')
  await completion.achieve()
  await completion.skipCelebration()
  await completion.skipPhoto()

  await completion.pickBrokenPhotoFromHistory('写真を付ける')
  await expect(page.getByText('この写真は読み込めませんでした。別の写真を選んでください')).toBeVisible()
  await expect(completion.historyPhotos()).toHaveCount(0)
  await expect(completion.historyButton('写真を付ける')).toBeEnabled()
})

test('やったリストの項目で 🎉 を押すと、写真だけを聞く。ファイルの選択を閉じたらそのまま閉じる', async ({ page, request }) => {
  const seed = new OptionSeed(request)
  await seed.complete(await seed.add('フルマラソン'))
  await page.goto('/done')
  const sheet = new OptionSheetScreen(page)
  const completion = new CompletionScreen(page)
  await sheet.openFromCard('フルマラソン')
  await completion.achieve()
  await completion.skipCelebration()
  await completion.skipPhoto()

  await expect(completion.moveConfirm()).toBeHidden()
  await expect(sheet.sheet()).toContainText('🎉×1')
  await expect(completion.history()).toHaveCount(1)

  await completion.achieve()
  await completion.skipCelebration()
  await completion.cancelPicking('prompt')
  await expect(completion.photoPrompt()).toBeHidden()
  await expect(sheet.sheet()).toBeVisible()
})

test('視差効果を減らす設定では、紙吹雪を出さずにメッセージだけを出す', async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await new OptionSeed(request).add('ヨガ')
  const list = new WishListScreen(page)
  await list.open()
  const sheet = new OptionSheetScreen(page)
  const completion = new CompletionScreen(page)
  await sheet.openFromCard('ヨガ')
  await completion.achieve()
  await expect(completion.message()).toBeVisible()
  await expect(completion.confetti()).toHaveCount(0)
  await completion.skipCelebration()
  await expect(completion.moveConfirm()).toBeVisible()
})

test('演出の途中で Esc でシートを閉じたら、演出が終わっても移動の確認は出ない', async ({ page, request }) => {
  await new OptionSeed(request).add('キャンプ')
  const list = new WishListScreen(page)
  await list.open()
  const sheet = new OptionSheetScreen(page)
  const completion = new CompletionScreen(page)
  await sheet.openFromCard('キャンプ')
  await completion.achieve()
  await expect(completion.message()).toBeVisible()
  await sheet.close()
  // 演出は 1.5 秒で消える。消えたあとも確認は出ず、カードはやりたいリストに残る
  await expect(completion.message()).toBeHidden()
  await expect(completion.photoPrompt()).toBeHidden()
  await expect(completion.moveConfirm()).toBeHidden()
  await expect(list.titleCells()).toHaveText(['キャンプ'])
})
