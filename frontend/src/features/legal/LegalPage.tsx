import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { IconButton } from '../../components/IconButton'
import { PageHeader } from '../../components/PageHeader'
import styles from './Legal.module.css'
import { LEGAL_INFO } from './legalInfo'

export type LegalSection = { heading: string; paragraphs: readonly string[] }

type Props = { title: string; sections: readonly LegalSection[] }

// プライバシーポリシー・利用規約の共通の枠（screens.md §10）。ヘッダーに戻るボタンと見出し、タブバーなしの文章だけのページ
// 戻るは、アプリの中から来たら 1 つ前へ。URL を直接開いた（履歴の最初）ときはやりたいリストへ
export function LegalPage({ title, sections }: Props) {
  const navigate = useNavigate()
  const location = useLocation()
  // 一覧をスクロールしたまま開いても、本文の頭から読めるようにする（アプリには移動でスクロールを戻す仕組みがない）
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [])
  const back = () => {
    if (location.key === 'default') void navigate('/', { replace: true })
    else void navigate(-1)
  }
  return (
    <>
      <PageHeader title={title} start={<IconButton icon="back" label="戻る" onClick={back} />} />
      <main className={styles.page}>
        {sections.map(({ heading, paragraphs }) => (
          <section key={heading} className={styles.section}>
            <h2 className={styles.heading}>{heading}</h2>
            {paragraphs.map((text) => (
              <p key={text} className={styles.text}>
                {text}
              </p>
            ))}
          </section>
        ))}
        <dl className={styles.info}>
          <dt>運営者</dt>
          <dd>{LEGAL_INFO.operator}</dd>
          <dt>お問い合わせ</dt>
          <dd className={styles.email}>{LEGAL_INFO.contactEmail}</dd>
          <dt>制定日</dt>
          <dd>{LEGAL_INFO.enactedOn}</dd>
        </dl>
      </main>
    </>
  )
}
