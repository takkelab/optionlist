import { expect, test } from '@playwright/test'
import { OptionSeed } from '../support/OptionSeed'
import { MySqlTestData } from '../support/TestData'
import { OptionSheetScreen } from '../support/OptionSheetScreen'
import { WishListScreen } from '../support/WishListScreen'
import type { SlideFrame } from '../support/WishListScreen'

const data = new MySqlTestData()

test.beforeEach(async () => {
  await data.reset()
})

test.afterAll(async () => {
  await data.close()
})

test('タブで「やりたい」と「提案」を行き来できる', async ({ page }) => {
  const screen = new WishListScreen(page)
  await screen.open()
  const tabs = page.getByRole('navigation', { name: '画面の切り替え' })

  const suggestions = tabs.getByRole('link', { name: '提案' })
  await suggestions.click()
  await expect(page).toHaveURL('/suggestions')
  await expect(page.getByRole('heading', { name: '提案' })).toBeVisible()

  const wish = tabs.getByRole('link', { name: 'やりたい' })
  await wish.click()
  await expect(page).toHaveURL('/')
})

test('やったリストは「やりたい」タブの中の切り替えで開き、タブは「やりたい」のまま', async ({ page }) => {
  const screen = new WishListScreen(page)
  await screen.open()
  const tabs = page.getByRole('navigation', { name: '画面の切り替え' })
  const wishTab = tabs.getByRole('link', { name: 'やりたい' })

  await screen.showDone()
  await expect(page).toHaveURL('/done')
  // 見出しの役目は、切り替えで選ばれている側がする
  await expect(screen.currentStatus()).toHaveText('やったこと')
  await expect(wishTab).toHaveAttribute('aria-current', 'true')

  await screen.showWish()
  await expect(page).toHaveURL('/')
  await expect(screen.currentStatus()).toHaveText('やりたいこと')
})

test('切り替えを押すと一覧が左右に滑って入れ替わり、視差効果を減らす設定では動かさない', async ({ page }) => {
  const screen = new WishListScreen(page)
  await screen.open()
  // 動きは 0.26 秒ほどなので、切り替えた直後から細かく読む
  const slides = { intervals: [0, 20, 20, 20, 20, 50], timeout: 2000 }

  // やったことへは左へ抜けて右から入り、やりたいことへはその逆
  await screen.showDone()
  const toDone = expect.poll(() => screen.slideMotions(), slides)
  await toDone.toEqual(expect.arrayContaining(['slide-out-to-left', 'slide-in-from-right']))
  await expect(screen.currentStatus()).toHaveText('やったこと')
  const settled = expect.poll(() => screen.slideMotions())
  await settled.toEqual([])
  await screen.showWish()
  const toWish = expect.poll(() => screen.slideMotions(), slides)
  await toWish.toEqual(expect.arrayContaining(['slide-out-to-right', 'slide-in-from-left']))
  await expect(screen.currentStatus()).toHaveText('やりたいこと')

  // 今いる側を押しても滑らず、履歴も増えない
  const before = await page.evaluate(() => history.length)
  await screen.showWish()
  await expect(page).toHaveURL('/')
  expect(await screen.slideMotions()).toEqual([])
  expect(await page.evaluate(() => history.length)).toBe(before)

  await page.emulateMedia({ reducedMotion: 'reduce' })
  const settledAgain = expect.poll(() => screen.slideMotions())
  await settledAgain.toEqual([])
  await screen.showDone()
  await expect(screen.currentStatus()).toHaveText('やったこと')
  expect(await screen.slideMotions()).toEqual([])
})

test('切り替えた先のカードは、読み込みを待ってから一覧と一緒に滑ってくる', async ({ page, request }) => {
  const seed = new OptionSeed(request)
  await seed.add('まだやりたい')
  await seed.complete(await seed.add('もうやった'))
  const screen = new WishListScreen(page)
  await screen.open()

  // 動きが見えた最初の瞬間に、やったリストのカードがもう描かれている
  const frames: SlideFrame[] = []
  await screen.showDone()
  const started = expect.poll(
    async () => {
      const frame = await screen.slideFrame()
      frames.push(frame)
      const { motions } = frame
      return motions.length > 0
    },
    { intervals: [0, 10, 10, 10, 10, 20], timeout: 2000 },
  )
  await started.toBe(true)
  const first = frames.find(({ motions }) => motions.length > 0)
  expect(first).toMatchObject({ titles: ['もうやった'] })
})

test('切り替えに指が触れた瞬間に先の一覧を読み始め、離したあとは読み直さない', async ({ page }) => {
  const screen = new WishListScreen(page)
  await screen.open()
  // backend へのリクエストを数えるだけ（差し替えない）
  const requested: string[] = []
  page.on('request', (request) => {
    const url = request.url()
    if (url.includes('/api/options?status=completed')) requested.push(url)
  })
  const segment = page.getByRole('link', { name: 'やったこと', exact: true })
  const box = await segment.boundingBox()
  if (box === null) throw new Error('切り替えが見えていない')
  const { mouse } = page
  await mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await mouse.down()
  const prefetched = expect.poll(() => requested.length)
  await prefetched.toBe(1)
  await mouse.up()
  await expect(screen.currentStatus()).toHaveText('やったこと')
  // やったリストは空なので、空のときの案内が出たら読み込み終わり
  await expect(page.getByText('🎉 を押して、やったことをここに集めよう')).toBeVisible()
  expect(requested).toHaveLength(1)
})

test('切り替えは履歴に積まないので、戻ると切り替える前の画面に戻る', async ({ page }) => {
  await page.goto('/suggestions')
  const tabs = page.getByRole('navigation', { name: '画面の切り替え' })
  const wishTab = tabs.getByRole('link', { name: 'やりたい' })
  await wishTab.click()
  await expect(page).toHaveURL('/')

  const screen = new WishListScreen(page)
  await screen.showDone()
  await expect(page).toHaveURL('/done')

  await page.goBack()
  await expect(page).toHaveURL('/suggestions')
})

test('カードをタップしても画面は移らず、タブバーも出たまま', async ({ page }) => {
  const screen = new WishListScreen(page)
  await screen.open()
  await screen.add('朝日を見に行く')

  const sheet = new OptionSheetScreen(page)
  await sheet.openFromCard('朝日を見に行く')
  await expect(page).toHaveURL('/')
  await sheet.close()
  await expect(page.getByRole('navigation', { name: '画面の切り替え' })).toBeVisible()
})

test('下にスクロールするとヘッダーが上へ引っ込み、上に戻すと降りてくる', async ({ page, request }) => {
  for (let i = 1; i <= 20; i++) {
    const res = await request.post('/api/options', { data: { title: `やりたいこと ${i}` } })
    expect(res.status()).toBe(201)
  }
  const screen = new WishListScreen(page)
  await screen.open()
  // ヘッダーに見えているのは「やりたいこと｜やったこと」の切り替え（見出しは読み上げ用で画面には出ない）
  const header = page.getByRole('navigation', { name: 'やりたい・やったの切り替え' })
  await expect(header).toBeInViewport()

  await screen.scrollBy(600)
  await expect(header).not.toBeInViewport()

  await screen.scrollBy(-100)
  await expect(header).toBeInViewport()
})
