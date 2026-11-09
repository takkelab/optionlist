import { Outlet, Route, Routes } from 'react-router'
import { TabBar } from '../components/TabBar'
import { PrivacyPage } from '../features/legal/PrivacyPage'
import { TermsPage } from '../features/legal/TermsPage'
import { DonePage } from '../features/options/done/DonePage'
import { WishListPage } from '../features/options/list/WishListPage'
import { SuggestionDetailPage } from '../features/suggestions/SuggestionDetailPage'
import { SuggestionsPage } from '../features/suggestions/SuggestionsPage'
import { TagPage } from '../features/suggestions/TagPage'
import { ThemePage } from '../features/suggestions/ThemePage'
import styles from './AppRoutes.module.css'

// screens.md §1: タブのある画面
function TabLayout() {
  return (
    <>
      <main className={styles.withTabBar}>
        <Outlet />
      </main>
      <TabBar />
    </>
  )
}

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<TabLayout />}>
        <Route index element={<WishListPage />} />
        <Route path="suggestions" element={<SuggestionsPage />} />
        <Route path="suggestions/:id" element={<SuggestionDetailPage />} />
        <Route path="suggestions/tags/:tagId" element={<TagPage />} />
        <Route path="suggestions/themes/:themeId" element={<ThemePage />} />
        <Route path="done" element={<DonePage />} />
      </Route>
      {/* タブバーのない文章だけのページ（screens.md §10） */}
      <Route path="privacy" element={<PrivacyPage />} />
      <Route path="terms" element={<TermsPage />} />
    </Routes>
  )
}
