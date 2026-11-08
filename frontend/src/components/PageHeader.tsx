import type { ReactNode } from 'react'
import styles from './PageHeader.module.css'
import { useHeaderVisible } from './useHeaderVisible'

// 各画面の上部。左に戻るボタンなど（start）、右にボタンなど（end）を置ける
// center を渡すと、見出しの文字の代わりにそれを真ん中に出す（見出しは読み上げ用に見えない形で残す）
// 上に固定し、下にスクロールし始めたら上へ引っ込み、上に戻し始めたら降りてくる（screens.md §1）
export function PageHeader({
  title,
  start,
  center,
  end,
}: {
  title: string
  start?: ReactNode
  center?: ReactNode
  end?: ReactNode
}) {
  const visible = useHeaderVisible()
  return (
    <>
      <header className={visible ? styles.header : `${styles.header} ${styles.hidden}`}>
        <div className={styles.slot}>{start}</div>
        {center === undefined ? (
          <h1 className={styles.title}>{title}</h1>
        ) : (
          <div className={styles.center}>
            <h1 className={styles.srOnly}>{title}</h1>
            {center}
          </div>
        )}
        <div className={styles.slot}>{end}</div>
      </header>
      {/* 固定したヘッダーの下に中身が隠れないよう、その分だけ空ける */}
      <div className={styles.spacer} aria-hidden="true" />
    </>
  )
}
