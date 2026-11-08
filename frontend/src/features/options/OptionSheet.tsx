import { useCallback, useState } from 'react'
import type { MouseEvent, TouchEvent } from 'react'
import type { Option } from '../../../../shared/types'
import sheet from '../../components/Sheet.module.css'
import { useBackToClose } from '../../components/useBackToClose'
import { useModal } from '../../components/useModal'
import { useRetained } from '../../components/useRetained'
import { AchievementLabel } from '../../lib/AchievementLabel'
import type { ListActions } from '../../lib/OptionListActions'
import { PlannedDateLabel } from '../../lib/PlannedDateLabel'
import { SheetSwipe } from '../../lib/SheetSwipe'
import type { SwipeState } from '../../lib/SheetSwipe'
import { AchievementHistory } from './AchievementHistory'
import { CompletionActions } from './completion/CompletionActions'
import { ConsultButton } from './ConsultButton'
import styles from './OptionSheet.module.css'
import { usePhotoSave } from './photo/usePhotoSave'
import type { PhotoSave } from './photo/usePhotoSave'
import { PlanCalendar } from './PlanCalendar'
import { RemoveButton } from './RemoveButton'
import { SheetNotice } from './SheetNotice'
import { TitleField } from './TitleField'
import { useOptionDetail } from './useOptionDetail'

const achievements = new AchievementLabel()
const dates = new PlannedDateLabel()
const STATUS_LABEL = { pending: 'やりたい', completed: 'やった' } as const
const swipe = new SheetSwipe()

// どこから開いたか。list: やりたいリスト・やったリストのカード / added: 提案を追加した直後 / reopened: 提案 1 件の画面のボタンから開き直した
export type SheetOrigin = 'list' | 'added' | 'reopened'

type Props = {
  // 開いている項目。null なら閉じている
  option: Option | null
  onClose: () => void
  // 変更・🎉・移す・削除。成功したら true。失敗はトーストで知らせる
  actions: ListActions
  origin?: SheetOrigin
  // 追加元の提案の最初の一歩が手元にあれば渡す（詳細を読み終える前から出す）。なければ詳細から読む
  firstStep?: string | null
}

// screens.md §3 の項目のシート。カードを押すと画面の下から高さの 9 割まで出し、タイトル・予定日・AI に相談・🎉・削除をここで行う
// 提案 1 件の画面から開いたとき（origin が list 以外）は、上に追加したことと [取り消す] を出し、🎉 と削除の行を出さない（screens.md §5）
export function OptionSheet({ option, onClose, actions, origin = 'list', firstStep = null }: Props) {
  const open = option !== null
  const modal = useModal(open, onClose)
  useBackToClose(open, modal.ref, onClose)
  // 閉じる動きの間は、直前の項目を出しておく
  const shown = useRetained(option)
  // 写真の保存は、シートを閉じて開き直しても続く。中身は開くたびに作り直すので、ここで持つ
  const [photoRound, setPhotoRound] = useState(0)
  const photoChanged = useCallback(() => setPhotoRound((changes) => changes + 1), [])
  const photos = usePhotoSave(shown === null ? null : shown.id, actions, photoChanged)
  // 下へスワイプしている間は、シートごと指に付いて下がる（screens.md §3）。null なら指を置いていない
  const [drag, setDrag] = useState<SwipeState | null>(null)
  const [wasOpen, setWasOpen] = useState(open)
  // 開いた回数。閉じたあとも中身を残すので、開くたびに中身を作り直す（カレンダーの月や確認の状態を持ち越さない）
  const [round, setRound] = useState(0)
  // 閉じるときは引いた位置のまま残し、そこから下へ滑らせる（Sheet.module.css）。次に開くときに戻す
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setDrag(null)
      setRound(round + 1)
    }
  }
  // シートの外（背景）を押したら閉じる。中身はシートいっぱいに広げてあるので、dialog そのものが押されたら外
  const closeOutside = (event: MouseEvent<HTMLDialogElement>) => {
    const { target, currentTarget } = event
    if (target === currentTarget) onClose()
  }
  // 重ねて開いた dialog（AI に相談・削除の確認）の中のタッチは、DOM の親のこのシートにも届くので引かない。
  // 持ち手から始めたときは、中身をスクロールしていても引く（持ち手はスクロールしない）
  const touchStart = (event: TouchEvent<HTMLDivElement>) => {
    const { touches, timeStamp, target, currentTarget } = event
    const touch = touches.item(0)
    if (touch === null || !(target instanceof Element) || target.closest('dialog') !== currentTarget.closest('dialog')) return
    const fromGrip = target.closest('[data-grip]') !== null
    setDrag(swipe.start({ x: touch.clientX, y: touch.clientY, at: timeStamp }, fromGrip))
  }
  // 中身のスクロールの位置を見て、引くかスクロールに任せるかを決める
  const touchMove = (event: TouchEvent<HTMLDivElement>) => {
    const { touches, timeStamp, currentTarget } = event
    const touch = touches.item(0)
    if (touch === null || drag === null) return
    const { scrollTop } = currentTarget
    setDrag(swipe.move(drag, { x: touch.clientX, y: touch.clientY, at: timeStamp }, scrollTop))
  }
  // 閉じないときは引いた量を消し、元の位置へ滑って戻す（Sheet.module.css の transition）
  const touchEnd = (event: TouchEvent<HTMLDivElement>) => {
    const { timeStamp } = event
    if (drag !== null && swipe.closes(drag, timeStamp)) onClose()
    else setDrag(null)
  }
  const pulling = drag !== null && drag.from !== null
  const touch = { onTouchStart: touchStart, onTouchMove: touchMove, onTouchEnd: touchEnd, onTouchCancel: () => setDrag(null) }
  return (
    <dialog
      {...modal}
      className={`${sheet.sheet} ${styles.tall}`}
      style={pulling ? { transform: `translateY(${drag.by}px)`, transition: 'none' } : undefined}
      aria-label="項目のシート"
      onClick={closeOutside}
    >
      {shown !== null && (
        <SheetBody
          key={`${round}-${shown.id}`}
          option={shown}
          active={open}
          touch={touch}
          onClose={onClose}
          actions={actions}
          origin={origin}
          firstStep={firstStep}
          photos={photos}
          photoRound={photoRound}
        />
      )}
    </dialog>
  )
}

// シートの中身のタッチの扱い（OptionSheet が持つ）
type TouchHandlers = {
  onTouchStart: (event: TouchEvent<HTMLDivElement>) => void
  onTouchMove: (event: TouchEvent<HTMLDivElement>) => void
  onTouchEnd: (event: TouchEvent<HTMLDivElement>) => void
  onTouchCancel: () => void
}

type BodyProps = Omit<Props, 'option' | 'origin' | 'firstStep'> & {
  option: Option
  active: boolean
  touch: TouchHandlers
  origin: SheetOrigin
  firstStep: string | null
  photos: PhotoSave
  photoRound: number
}

function SheetBody({ option, active, touch, onClose, actions, origin, firstStep: known, photos, photoRound }: BodyProps) {
  const { id, title, plannedOn } = option
  const count = achievements.format(option.achievementCount)
  const detail = useOptionDetail(id, option.achievementCount, photoRound)
  const firstStep = known ?? detail?.firstStep ?? null
  // 提案 1 件の画面から開いた、やりたいリストにある項目（screens.md §5）。やったリストにある項目はやったリストと同じシートにする
  const justFromSuggestion = origin !== 'list' && option.status === 'pending'

  return (
    <div className={styles.body} {...touch}>
      <div className={styles.grip} data-grip>
        <span className={styles.handle} aria-hidden="true" />
      </div>
      {origin !== 'list' && <SheetNotice option={option} origin={origin} actions={actions} onClose={onClose} />}
      <TitleField title={title} onSave={(next) => actions.update(id, { title: next }, 'タイトルを保存できませんでした')} />
      <div className={styles.status}>
        <span className={styles.badge}>{STATUS_LABEL[option.status]}</span>
        {count !== null && <span className={styles.count}>{count}</span>}
      </div>
      {firstStep !== null && (
        <section className={styles.firstStep} aria-label="最初の一歩">
          <h3 className={styles.firstStepHeading}>最初の一歩</h3>
          <p className={styles.firstStepText}>{firstStep}</p>
          <ConsultButton title={title} plannedOn={plannedOn} firstStep={firstStep} />
        </section>
      )}
      <section className={styles.plan} aria-label="予定日">
        <h3 className={styles.heading}>
          予定日
          <span className={plannedOn === null ? styles.undecided : styles.date} data-sheet-planned-on>
            {plannedOn === null ? '未定' : dates.long(plannedOn)}
          </span>
        </h3>
        {justFromSuggestion && plannedOn === null && (
          <p className={styles.planNote}>今は決めなくて大丈夫です。決まったら、やりたいリストからいつでも入れられます。</p>
        )}
        <PlanCalendar value={plannedOn} onChange={(date) => void actions.update(id, { plannedOn: date }, '予定日を保存できませんでした')} />
      </section>
      {/* 提案から追加した項目は AI に聞くを出すので、最初の一歩を読み終える前でも AI に相談は出さない（screens.md §3） */}
      {option.suggestionId === null && <ConsultButton title={title} plannedOn={plannedOn} />}
      {/* 追加してすぐやり終えることはまずないので、提案から開いたやりたいリストの項目には 🎉 を出さない */}
      {!justFromSuggestion && (
        <CompletionActions
          option={option}
          active={active}
          onAchieve={(target) => actions.achieve(target)}
          onMove={(target, status) => actions.move(target, status)}
          onClose={onClose}
          photos={photos}
        />
      )}
      <AchievementHistory achievements={detail?.achievements ?? null} photos={photos} />
      {justFromSuggestion ? (
        // ✕ は置かない（0017）。勝手に出たシートで閉じ方に迷わないよう、次にやることを示す言葉で閉じる
        <button type="button" className={styles.later} onClick={onClose}>
          ほかの提案を見る
        </button>
      ) : (
        <RemoveButton option={option} actions={actions} onClose={onClose} />
      )}
    </div>
  )
}
