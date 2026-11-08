import { expect, test } from '@playwright/test'
import { OptionSeed } from '../support/OptionSeed'
import { OptionSheetScreen } from '../support/OptionSheetScreen'
import { SuggestionData, SuggestionsScreen } from '../support/SuggestionsScreen'
import { PgTestData } from '../support/TestData'
import { WishListScreen } from '../support/WishListScreen'

// 種まきの API（page.request）はブラウザと同じ Cookie（同じ人）で呼ぶ（api.md §6）
const data = new PgTestData()
// 今月のおすすめは端末の日付で決まるので、12 月に固定する（提案 1 は 12 月の「ふたご座流星群を見る」）
const DECEMBER = new Date('2026-12-10T10:00:00')
const GEMINIDS = 1

test.beforeEach(async ({ page }) => {
  await data.reset()
  const { clock } = page
  await clock.setFixedTime(DECEMBER)
})

test.afterAll(async () => {
  await data.close()
})

test('探す画面から提案を開いて追加すると、項目のシートが開き、閉じるとやりたいリストの先頭に入っている', async ({ page }) => {
  const seed = new OptionSeed(page.request)
  await seed.add('前からあるもの')
  const gem = await new SuggestionData(page.request).detail(GEMINIDS)
  const screen = new SuggestionsScreen(page)
  await screen.openExplore()

  const picks = screen.list('12 月のおすすめ')
  const pickLinks = picks.getByRole('link')
  const pick = pickLinks.filter({ hasText: gem.hook })
  await pick.click()
  await expect(page).toHaveURL(`/suggestions/${GEMINIDS}`)
  await expect(screen.heading()).toHaveText(gem.hook)

  const add = screen.addButton()
  await expect(add).toHaveText('やりたいリストに追加')
  await add.click()

  // 追加したらその場で項目のシートを開く。最初の一歩があり、🎉 と削除はない（screens.md §5）
  const sheet = new OptionSheetScreen(page)
  await expect(sheet.sheet()).toBeVisible()
  await expect(sheet.notice()).toHaveText('✓やりたいリストに入れました')
  await expect(sheet.firstStep()).toContainText(gem.firstStep)
  await expect(sheet.sheet()).toContainText('今は決めなくて大丈夫です')
  await expect(sheet.button('🎉 やった')).toHaveCount(0)
  await expect(sheet.button('🗑 この項目を削除')).toHaveCount(0)
  await expect(screen.toast()).toBeHidden()

  const later = sheet.button('ほかの提案を見る')
  await later.click()
  await expect(sheet.sheet()).toBeHidden()
  await expect(add).toHaveText('やりたいリストにあります')
  await expect(add).toBeEnabled()

  // 戻ると、探す画面の行にも「追加済み」の印が付いている
  await screen.back()
  await expect(page).toHaveURL('/suggestions')
  await expect(screen.row(gem.hook)).toContainText('追加済み')

  const tabs = page.getByRole('navigation', { name: '画面の切り替え' })
  const wishTab = tabs.getByRole('link', { name: 'やりたい' })
  await wishTab.click()
  const wish = new WishListScreen(page)
  await expect(wish.titleCells()).toHaveText([gem.title, '前からあるもの'])
})

test('追加したシートの AI に聞くは、最初の一歩を聞く相談文になる', async ({ page }) => {
  const gem = await new SuggestionData(page.request).detail(GEMINIDS)
  const screen = new SuggestionsScreen(page)
  await screen.openSuggestion(GEMINIDS)
  await screen.add()

  const sheet = new OptionSheetScreen(page)
  const ask = await sheet.openAsk()
  const text = ask.getByRole('textbox', { name: '相談文' })
  await expect(text).toHaveValue(`「${gem.title}」をやってみたいです。まずは、最初の一歩を教えてください。今は「${gem.firstStep}」ところから始めようと思っています。わからないことがあれば、先に私に質問してください。`)
  await expect(sheet.button('💬 AI に相談')).toHaveCount(0)
})

test('ボタンからシートを開き直して取り消すと、やりたいリストから消え、ボタンが戻る', async ({ page }) => {
  const gem = await new SuggestionData(page.request).detail(GEMINIDS)
  const screen = new SuggestionsScreen(page)
  await screen.openSuggestion(GEMINIDS)
  await screen.add()
  const sheet = new OptionSheetScreen(page)
  // シートは追加の応答のあとで開くので、開くのを待ってから閉じる
  await expect(sheet.notice()).toHaveText('✓やりたいリストに入れました')
  await sheet.close()

  await screen.add()
  await expect(sheet.notice()).toHaveText('✓やりたいリストにあります')
  const undo = sheet.button('取り消す')
  await undo.click()
  await expect(sheet.sheet()).toBeHidden()
  await expect(screen.addButton()).toHaveText('やりたいリストに追加')
  expect(await new OptionSeed(page.request).pendingTitles()).not.toContain(gem.title)
})

test('達成記録がある項目を取り消すときだけ、確かめてから消す', async ({ page }) => {
  const gem = await new SuggestionData(page.request).detail(GEMINIDS)
  const seed = new OptionSeed(page.request)
  await seed.achieve(await seed.addSuggestion(GEMINIDS, gem.title))
  const screen = new SuggestionsScreen(page)
  await screen.openSuggestion(GEMINIDS)
  await screen.add()

  const sheet = new OptionSheetScreen(page)
  const undo = sheet.button('取り消す')
  await undo.click()
  const confirm = page.getByRole('dialog', { name: /をやりたいリストから外しますか？/ })
  const remove = confirm.getByRole('button', { name: '外す' })
  await remove.click()
  await expect(sheet.sheet()).toBeHidden()
  await expect(screen.addButton()).toHaveText('やりたいリストに追加')
})

test('シートを開いたまま戻ると、シートだけが閉じて提案の画面に残る', async ({ page }) => {
  const screen = new SuggestionsScreen(page)
  await screen.openExplore()
  await screen.openRow(0)
  const url = page.url()
  await screen.add()
  const sheet = new OptionSheetScreen(page)
  await expect(sheet.sheet()).toBeVisible()

  await page.goBack()
  await expect(sheet.sheet()).toBeHidden()
  expect(page.url()).toBe(url)
  // もう一度戻ると、探す画面へ戻る（積んだ履歴は残っていない）
  await page.goBack()
  await expect(page).toHaveURL('/suggestions')
})

test('提案から追加した項目は、やりたいリストのシートにも最初の一歩と AI に聞くが出る', async ({ page }) => {
  const gem = await new SuggestionData(page.request).detail(GEMINIDS)
  await new OptionSeed(page.request).addSuggestion(GEMINIDS, gem.title)
  await page.goto('/')
  const sheet = new OptionSheetScreen(page)
  await sheet.openFromCard(gem.title)

  await expect(sheet.firstStep()).toContainText(gem.firstStep)
  await expect(sheet.button('💬 AI に聞く')).toBeVisible()
  await expect(sheet.button('💬 AI に相談')).toHaveCount(0)
  // やりたいリストから開いたときは、いつもどおり 🎉 がある
  await expect(sheet.button('🎉 やった')).toBeVisible()
})

test('追加を押してシートが開く前に関連へ移っても、移った先の提案は変わらず、戻っても勝手にシートは開かない', async ({ page }) => {
  const gem = await new SuggestionData(page.request).detail(GEMINIDS)
  const [related] = gem.related
  if (related === undefined) throw new Error(`提案 ${GEMINIDS} に関連がない`)
  const screen = new SuggestionsScreen(page)
  await screen.openSuggestion(GEMINIDS)
  const relatedList = screen.list('関連')
  const links = relatedList.getByRole('link')
  const relatedRow = links.filter({ hasText: related.hook })
  await relatedRow.scrollIntoViewIfNeeded()

  // シートが開く（0.4 秒）前に関連へ移る
  await screen.add()
  await relatedRow.click()
  await expect(page).toHaveURL(`/suggestions/${related.id}`)
  await expect(screen.heading()).toHaveText(related.hook)
  const add = screen.addButton()
  await expect(add).toHaveText('やりたいリストに追加')
  await expect(add).toBeEnabled()
  const sheet = new OptionSheetScreen(page)
  await expect(sheet.sheet()).toBeHidden()

  // 押した提案は追加できていて、戻るとボタンに出る。シートは開かない
  await page.goBack()
  await expect(screen.heading()).toHaveText(gem.hook)
  await expect(add).toHaveText('やりたいリストにあります')
  await expect(sheet.sheet()).toBeHidden()
  expect(await new OptionSeed(page.request).pendingTitles()).toContain(gem.title)
})

test('関連の提案へ移り、戻るで元の提案に戻れる。タグを押すとタグの一覧に移る', async ({ page }) => {
  const gem = await new SuggestionData(page.request).detail(GEMINIDS)
  const { related: relatedSuggestions, tags } = gem
  const [related] = relatedSuggestions
  const [tag] = tags
  if (related === undefined || tag === undefined) throw new Error(`提案 ${GEMINIDS} に関連かタグがない`)
  const screen = new SuggestionsScreen(page)
  await screen.openSuggestion(GEMINIDS)

  const relatedList = screen.list('関連')
  const relatedLinks = relatedList.getByRole('link')
  await expect(relatedLinks).toHaveCount(relatedSuggestions.length)
  const relatedRow = relatedLinks.filter({ hasText: related.hook })
  await relatedRow.click()
  await expect(page).toHaveURL(`/suggestions/${related.id}`)
  await expect(screen.heading()).toHaveText(related.hook)
  // 関連から移ったら一番上から出す
  expect(await screen.scrollY()).toBe(0)

  await page.goBack()
  await expect(page).toHaveURL(`/suggestions/${GEMINIDS}`)
  await expect(screen.heading()).toHaveText(gem.hook)

  await screen.openTag(tag.name)
  await expect(page).toHaveURL(`/suggestions/tags/${tag.id}`)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`#${tag.name}`)
  await expect(screen.row(gem.hook)).toBeVisible()
  // タグの一覧でも「提案」タブを選んだ表示にする
  const tabs = page.getByRole('navigation', { name: '画面の切り替え' })
  await expect(tabs.getByRole('link', { name: '提案' })).toHaveAttribute('aria-current', 'true')

  await screen.back()
  await expect(page).toHaveURL(`/suggestions/${GEMINIDS}`)
})

test('テーマの「すべて N 件」でテーマの一覧に移り、チップで絞っていても全件を出す。戻るで探す画面に戻る', async ({ page }) => {
  const { themes, suggestions } = await new SuggestionData(page.request).catalog()
  const [theme] = themes
  if (theme === undefined) throw new Error('テーマがない')
  const inTheme = suggestions.filter((s) => s.themeId === theme.id)
  const screen = new SuggestionsScreen(page)
  await screen.openExplore()
  await screen.toggleFilter()
  const chip = screen.chip('1 時間以内')
  await chip.click()

  const seeAll = page.getByRole('link', { name: `${theme.name} すべて ${inTheme.length} 件`, exact: true })
  await seeAll.click()
  await expect(page).toHaveURL(`/suggestions/themes/${theme.id}`)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(theme.name)
  await expect(page.getByText(`${inTheme.length} 件`, { exact: true })).toBeVisible()
  const themeList = screen.list(`${theme.name} の提案`)
  const rows = themeList.getByRole('link')
  await expect(rows).toHaveCount(inTheme.length)
  const tabs = page.getByRole('navigation', { name: '画面の切り替え' })
  await expect(tabs.getByRole('link', { name: '提案' })).toHaveAttribute('aria-current', 'true')

  await screen.openRow(0)
  await expect(screen.heading()).toBeVisible()
  await page.goBack()
  await expect(page).toHaveURL(`/suggestions/themes/${theme.id}`)

  await screen.back()
  await expect(page).toHaveURL('/suggestions?size=hour')
})

test('絞り込みを開いてチップで絞り、もう一度押すと外れる。開いて戻っても絞ったまま。絞ったまましまうと外れる', async ({ page }) => {
  const screen = new SuggestionsScreen(page)
  await screen.openExplore()
  const all = await screen.rowTexts()
  const quick = screen.list('今日すぐできる')
  const quickLinks = quick.getByRole('link')
  await expect(quickLinks.first()).toBeVisible()

  const chip = screen.chip('1 時間以内')
  await expect(chip).toBeHidden()
  await screen.toggleFilter()
  await chip.click()
  await expect(chip).toHaveAttribute('aria-pressed', 'true')
  await expect(page).toHaveURL('/suggestions?size=hour')
  // チップを選んでいる間は、今日すぐできるを出さない
  await expect(quick).toBeHidden()
  const narrowed = await screen.rowTexts()
  expect(narrowed.length).toBeGreaterThan(0)
  expect(narrowed.length).toBeLessThan(all.length)
  for (const text of narrowed) expect(text).toContain('1 時間以内')

  await screen.openRow(0)
  await expect(screen.heading()).toBeVisible()
  await page.goBack()
  await expect(chip).toHaveAttribute('aria-pressed', 'true')
  await expect(screen.rows()).toHaveCount(narrowed.length)

  await chip.click()
  await expect(chip).toHaveAttribute('aria-pressed', 'false')
  await expect(screen.rows()).toHaveCount(all.length)

  await chip.click()
  await screen.toggleFilter()
  await expect(chip).toBeHidden()
  await expect(page).toHaveURL('/suggestions')
  await expect(screen.rows()).toHaveCount(all.length)
})

test('提案を開いて戻ると、離れたときのスクロール位置に戻る', async ({ page }) => {
  const screen = new SuggestionsScreen(page)
  await screen.openExplore()
  await screen.scrollToRow(40)
  const before = await screen.scrollY()
  expect(before).toBeGreaterThan(0)

  await screen.openRow(40)
  await expect(screen.heading()).toBeVisible()
  await page.goBack()
  await expect(page).toHaveURL('/suggestions')
  const restored = expect.poll(() => screen.scrollY())
  await restored.toBe(before)
})

test('やったリストにある提案は、押すとやったリストと同じシートが開き、行にも「やった」が付く', async ({ page }) => {
  const gem = await new SuggestionData(page.request).detail(GEMINIDS)
  const seed = new OptionSeed(page.request)
  await seed.complete(await seed.addSuggestion(GEMINIDS, gem.title))
  const screen = new SuggestionsScreen(page)
  await screen.openSuggestion(GEMINIDS)
  await expect(screen.addButton()).toHaveText('やったリストにあります')

  await screen.add()
  const sheet = new OptionSheetScreen(page)
  await expect(sheet.notice()).toHaveText('✓やったリストにあります')
  await expect(sheet.button('取り消す')).toHaveCount(0)
  // やりたいリストに戻すと、シートが閉じてボタンが変わる
  const back = sheet.button('やりたいリストに戻す')
  await back.click()
  await expect(sheet.sheet()).toBeHidden()
  await expect(screen.addButton()).toHaveText('やりたいリストにあります')
  await seed.complete(await seed.firstPendingId())

  await screen.openExplore()
  await expect(screen.row(gem.hook)).toContainText('やった')
})

test('別の端末で先に追加されていたら「もう追加してあります」と出し、その項目のシートを開く', async ({ page }) => {
  const gem = await new SuggestionData(page.request).detail(GEMINIDS)
  const screen = new SuggestionsScreen(page)
  await screen.openSuggestion(GEMINIDS)
  await new OptionSeed(page.request).addSuggestion(GEMINIDS, gem.title)

  await screen.add()
  await expect(screen.toast()).toHaveText('もう追加してあります')
  const sheet = new OptionSheetScreen(page)
  await expect(sheet.notice()).toHaveText('✓やりたいリストにあります')
  await expect(screen.addButton()).toHaveText('やりたいリストにあります')
})

test('存在しない提案・タグ・テーマは「見つかりません」と出し、URL を直接開いて戻ると探す画面へ', async ({ page }) => {
  const screen = new SuggestionsScreen(page)
  await screen.openSuggestion(99999)
  await expect(page.getByText('この提案は見つかりません')).toBeVisible()
  await screen.back()
  await expect(page).toHaveURL('/suggestions')

  await page.goto('/suggestions/tags/abc')
  await expect(page.getByText('このタグは見つかりません')).toBeVisible()
  const toExplore = page.getByRole('link', { name: '提案を探す' })
  await toExplore.click()
  await expect(page).toHaveURL('/suggestions')

  await page.goto('/suggestions/themes/99999')
  await expect(page.getByText('このテーマは見つかりません')).toBeVisible()
})
