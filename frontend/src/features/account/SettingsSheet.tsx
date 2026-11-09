import type { MouseEvent } from 'react'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import sheet from '../../components/Sheet.module.css'
import { useBackToClose } from '../../components/useBackToClose'
import { useModal } from '../../components/useModal'
import { useSheetSwipe } from '../../components/useSheetSwipe'
import styles from './Account.module.css'
import { RecoveryCodeDialog } from './RecoveryCodeDialog'
import { RestoreDialog } from './RestoreDialog'
import { useAccountSettings } from './useAccountSettings'
import type { AccountSettings } from './useAccountSettings'

type Props = { open: boolean; onClose: () => void }

// screens.md §9 の設定のシート。項目のシート（§3）と同じく下から出て、下へスワイプ・外・戻るで閉じる
// 重ねるダイアログ（コードの表示・入力・確認）は、戻るで一緒に閉じるよう、このシートの dialog の中に置く（useBackToClose）
export function SettingsSheet({ open, onClose }: Props) {
  const modal = useModal(open, onClose)
  useBackToClose(open, modal.ref, onClose)
  const { round, style, touch } = useSheetSwipe(open, onClose)
  const settings = useAccountSettings(open, onClose)
  const { code, restoring, setRestoring, restored, removing, setRemoving, removeBusy, removeAll } = settings
  const closeOutside = (event: MouseEvent<HTMLDialogElement>) => {
    const { target, currentTarget } = event
    if (target === currentTarget) onClose()
  }
  return (
    <dialog {...modal} className={sheet.sheet} style={style} aria-label="設定" onClick={closeOutside}>
      <div key={round} className={sheet.body} {...touch}>
        <div className={sheet.grip} data-grip>
          <span className={sheet.handle} aria-hidden="true" />
        </div>
        <SettingsBody settings={settings} />
      </div>
      <RecoveryCodeDialog code={code.code} onClose={code.close} />
      <RestoreDialog open={restoring} onClose={() => setRestoring(false)} onRestored={restored} />
      <ConfirmDialog
        open={removing}
        message="やりたいこと・やったこと・写真をすべて消します。元に戻せません"
        confirmLabel="すべて消す"
        cancelLabel="やめる"
        danger
        busy={removeBusy}
        onConfirm={() => void removeAll()}
        onCancel={() => setRemoving(false)}
      />
    </dialog>
  )
}

function SettingsBody({ settings }: { settings: AccountSettings }) {
  const { status, needsNewCode, code, setRestoring, setRemoving } = settings
  const hasAccount = status !== null && status.hasAccount
  return (
    <>
      <section className={styles.section} aria-label="機種変更に備える">
        <h3 className={styles.heading}>
          機種変更に備える
          {hasAccount && needsNewCode && <span className={styles.mark} aria-hidden="true" />}
        </h3>
        {status !== null && !hasAccount && <p className={styles.note}>まだ何も保存されていません</p>}
        {hasAccount && (
          <>
            <p className={styles.note}>
              復旧コードを控えておくと、ほかの端末やブラウザでも続きから使えます。コードを知っている人は誰でもこのリストを開けるので、人に見せないでください
            </p>
            {needsNewCode && !status.hasRecoveryCode && <p className={styles.markNote}>引き継ぎに使ったコードは使えなくなりました。新しいコードを控えてください</p>}
            <button type="button" className={styles.action} disabled={code.busy} onClick={() => void code.issue()}>
              {status.hasRecoveryCode ? '復旧コードを作り直す' : '復旧コードを表示する'}
            </button>
            {status.hasRecoveryCode && <p className={styles.note}>作り直すと、前のコードは使えなくなります</p>}
          </>
        )}
      </section>
      <section className={styles.section} aria-label="前の端末から引き継ぐ">
        <h3 className={styles.heading}>前の端末から引き継ぐ</h3>
        <button type="button" className={styles.secondary} onClick={() => setRestoring(true)}>
          復旧コードを入れる
        </button>
      </section>
      <section className={styles.section} aria-label="データについて">
        <h3 className={styles.heading}>データについて</h3>
        {/* プライバシーポリシー・利用規約のリンクは、ページを作る R6 で足す（docs/decisions/0049） */}
        <p className={styles.links}>5 年間使わないと、データは消えます</p>
      </section>
      {hasAccount && (
        <button type="button" className={styles.removeAll} onClick={() => setRemoving(true)}>
          🗑 すべてのデータを消す
        </button>
      )}
    </>
  )
}
