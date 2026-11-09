import { expect, test } from '@playwright/test'
import { AccountScreen } from '../support/AccountScreen'
import { CompletionScreen } from '../support/CompletionScreen'
import { OptionSeed } from '../support/OptionSeed'
import { PgTestData } from '../support/TestData'
import { OptionSheetScreen } from '../support/OptionSheetScreen'
import { SuggestionsScreen } from '../support/SuggestionsScreen'
import { UiProbe } from '../support/UiProbe'
import type { SmallTapTarget } from '../support/UiProbe'
import { WishListScreen } from '../support/WishListScreen'

// metrics.md §3 の LCP（各画面、幅 390px）とタップ領域を測り、results/ui-metrics.json に書く
// 判定は npm run metrics:check（scripts/lib/e2e-collector.ts）が行う。ここでは測るだけ
const data = new PgTestData()
const probe = new UiProbe()
const SAMPLE_OPTIONS = 20

test.afterAll(async () => {
  await data.close()
})

test('各画面の LCP とタップ領域を測る', async ({ page }) => {
  // 種まきの API はブラウザと同じ Cookie（同じ人）で呼ぶ（api.md §6）
  const { request } = page
  await data.reset()
  const smallTapTargets: SmallTapTarget[] = []
  // アカウントがまだないときの追加ダイアログ（保存場所の注記とポリシーへのリンク。screens.md §2）
  const screen = new WishListScreen(page)
  await screen.open()
  const firstAdd = await screen.openAddDialog()
  const policyLink = firstAdd.getByRole('link', { name: 'プライバシーポリシー' })
  await policyLink.waitFor()
  smallTapTargets.push(...(await probe.smallTapTargets(page, '/（追加ダイアログ・アカウントなし）')))
  for (let i = 1; i <= SAMPLE_OPTIONS; i++) {
    const res = await request.post('/api/options', { data: { title: `やりたいこと ${i}` } })
    expect(res.status()).toBe(201)
  }
  const created = await request.get('/api/options?status=pending')
  const [first] = (await created.json()) as { id: number }[]
  const id = first?.id ?? 1
  // 項目のシートは予定日が入った状態で測る
  const patched = await request.patch(`/api/options/${id}`, { data: { plannedOn: '2026-11-23' } })
  expect(patched.status()).toBe(200)
  // やったリストはカードがある状態で測る
  const seed = new OptionSeed(request)
  for (let i = 1; i <= 5; i++) await seed.complete(await seed.add(`やったこと ${i}`))
  // 提案 1 件は関連とタグのある 1 件目、タグの一覧は 1 つ目のタグ、テーマの一覧は 1 つ目のテーマで測る
  const screens = ['/', '/suggestions', '/suggestions/1', '/suggestions/tags/1', '/suggestions/themes/1', '/done', '/privacy', '/terms']
  const suggestionsScreen = new SuggestionsScreen(page)

  const lcpSec: Record<string, number> = {}
  const sheet = new OptionSheetScreen(page)
  for (const path of screens) {
    await page.goto(path)
    const heading = page.getByRole('heading', { level: 1 })
    await heading.waitFor()
    // 一覧はカード・提案の行が出てから測る（見出しは API の応答より先に出る）。ポリシー・規約は文章だけ
    if (path.startsWith('/suggestions')) await suggestionsScreen.waitForRows()
    else if (path === '/' || path === '/done') await screen.waitUntilLoaded()
    lcpSec[path] = await probe.lcpSec(page)
    smallTapTargets.push(...(await probe.smallTapTargets(page, path)))
  }

  // 探す画面の一歩の大きさのチップ（「絞り込み」を押したときだけ出る）
  await page.goto('/suggestions')
  await suggestionsScreen.waitForRows()
  await suggestionsScreen.toggleFilter()
  const chip = suggestionsScreen.chip('1 時間以内')
  await chip.waitFor()
  smallTapTargets.push(...(await probe.smallTapTargets(page, '/suggestions（絞り込み）')))

  // 追加ダイアログのボタンと入力欄
  await screen.open()
  await screen.openAddDialog()
  smallTapTargets.push(...(await probe.smallTapTargets(page, '/（追加ダイアログ）')))

  // 項目のシート（カレンダー）と、12 か月のボタン、相談文、タイトルの入力、削除の確認
  const title = `やりたいこと ${SAMPLE_OPTIONS}`
  await screen.open()
  await sheet.openFromCard(title)
  smallTapTargets.push(...(await probe.smallTapTargets(page, '項目のシート')))
  const calendarTitle = sheet.calendarTitle()
  await calendarTitle.click()
  smallTapTargets.push(...(await probe.smallTapTargets(page, '項目のシート（12 か月のボタン）')))
  await sheet.openConsult()
  smallTapTargets.push(...(await probe.smallTapTargets(page, '項目のシート（相談文）')))
  const consult = sheet.consultDialog()
  const closeConsult = consult.getByRole('button', { name: '閉じる' })
  await closeConsult.click()
  await sheet.startRenaming()
  smallTapTargets.push(...(await probe.smallTapTargets(page, '項目のシート（タイトルの入力）')))
  await screen.open()
  await sheet.openFromCard(title)
  await sheet.openDeleteConfirm()
  smallTapTargets.push(...(await probe.smallTapTargets(page, '項目のシート（削除の確認）')))

  // 🎉 のあとの移動の確認と、やったリストから開いたシート（やりたいリストに戻す）
  const completion = new CompletionScreen(page)
  await screen.open()
  await sheet.openFromCard(title)
  await completion.achieve()
  await completion.skipCelebration()
  await expect(completion.moveConfirm()).toBeVisible()
  smallTapTargets.push(...(await probe.smallTapTargets(page, '項目のシート（移動の確認）')))
  await completion.pickPhotoFromConfirm()
  await expect(completion.confirmPhoto()).toBeVisible()
  smallTapTargets.push(...(await probe.smallTapTargets(page, '項目のシート（移動の確認・写真あり）')))
  await page.goto('/done')
  await sheet.openFromCard('やったこと 1')
  smallTapTargets.push(...(await probe.smallTapTargets(page, '項目のシート（やったリスト）')))
  // 達成した日の写真のボタン（写真なし・写真あり）
  await completion.achieve()
  await completion.skipCelebration()
  await expect(completion.photoPrompt()).toBeVisible()
  smallTapTargets.push(...(await probe.smallTapTargets(page, '項目のシート（写真の確認）')))
  await completion.skipPhoto()
  smallTapTargets.push(...(await probe.smallTapTargets(page, '達成した日（写真なし）')))
  await completion.pickPhotoFromHistory('写真を付ける')
  await expect(completion.historyPhotos()).toHaveCount(1)
  smallTapTargets.push(...(await probe.smallTapTargets(page, '達成した日（写真あり）')))

  // 設定のシートと、その上のダイアログ（screens.md §9）。やりたいことが 5 件以上あるので、一覧の上に勧めるカードも出る
  await page.goto('/')
  await expect(page.getByRole('region', { name: '復旧コードを控える' })).toBeVisible()
  smallTapTargets.push(...(await probe.smallTapTargets(page, '/（復旧コードを勧めるカード）')))
  const account = new AccountScreen(page)
  const settings = await account.openSettings()
  await expect(settings.getByRole('button', { name: '復旧コードを表示する' })).toBeVisible()
  smallTapTargets.push(...(await probe.smallTapTargets(page, '設定のシート')))
  await account.press(settings, '復旧コードを入れる')
  const restore = page.getByRole('dialog', { name: '復旧コードを入れる' })
  await restore.waitFor()
  smallTapTargets.push(...(await probe.smallTapTargets(page, '設定のシート（復旧コードを入れる）')))
  await account.press(restore, 'キャンセル')
  await restore.waitFor({ state: 'hidden' })
  await account.press(settings, '復旧コードを表示する')
  const shown = page.getByRole('dialog', { name: '復旧コード' })
  await shown.waitFor()
  smallTapTargets.push(...(await probe.smallTapTargets(page, '設定のシート（復旧コード）')))
  await account.press(shown, '閉じる')
  await shown.waitFor({ state: 'hidden' })
  await account.press(settings, '🗑 すべてのデータを消す')
  await expect(page.getByRole('button', { name: 'すべて消す', exact: true })).toBeVisible()
  smallTapTargets.push(...(await probe.smallTapTargets(page, '設定のシート（すべて消す確認）')))

  probe.save({ lcpSec, smallTapTargets })
})
