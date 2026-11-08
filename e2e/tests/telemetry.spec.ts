import { expect, test } from '@playwright/test'
import { CompletionScreen } from '../support/CompletionScreen'
import { OptionSheetScreen } from '../support/OptionSheetScreen'
import { MySqlTestData } from '../support/TestData'
import { WishListScreen } from '../support/WishListScreen'

const data = new MySqlTestData()

test.beforeEach(async () => {
  await data.reset()
})

test.afterAll(async () => {
  await data.close()
})

// screens.md §8: トーストで知らせた失敗は client_error として保存される。testing.md §5 のシナリオ 9
test('API の失敗をトーストで知らせると、client_error が発生した画面と一緒に保存される', async ({ page, request }) => {
  const list = new WishListScreen(page)
  await list.open()
  await list.add('消される項目')
  const sheet = new OptionSheetScreen(page)
  await sheet.openFromCard('消される項目')
  // シートを開いている間に、別の端末で消されたことにする（🎉 の記録が 404 になる）
  const listed = await request.get('/api/options', { params: { status: 'pending' } })
  const [option] = (await listed.json()) as { id: number }[]
  const removed = await request.delete(`/api/options/${option?.id ?? 0}`)
  expect(removed.status()).toBe(204)

  await new CompletionScreen(page).achieve()
  await expect(page.getByRole('status', { name: 'お知らせ' })).toContainText('達成を記録できませんでした')

  const saved = expect.poll(() => data.events())
  await saved.toEqual([
    {
      type: 'client_error',
      payload: { message: expect.stringContaining('達成を記録できませんでした: AxiosError'), route: '/' },
    },
  ])
})

// 画面で拾えなかった例外（window の error）と、捕まえていない Promise の失敗（unhandledrejection）も送る
test('画面で拾えなかったエラーも、発生した画面と一緒に保存される', async ({ page }) => {
  await page.goto('/done')
  // 受け口は AppProviders の useEffect で付く。一覧を読んで描き直したのを待てば、付いている
  await expect(page.getByText('🎉 を押して、やったことをここに集めよう')).toBeVisible()
  await page.evaluate(() => {
    setTimeout(() => {
      throw new TypeError('拾えなかった例外')
    })
    void Promise.reject(new Error('捕まえていない失敗'))
  })

  const saved = expect.poll(async () => (await data.events()).map((event) => event.payload).toSorted((a, b) => String(a.message).localeCompare(String(b.message))))
  await saved.toEqual([
    { message: 'Error: 捕まえていない失敗', route: '/done' },
    { message: 'TypeError: 拾えなかった例外', route: '/done' },
  ])
})
