import { CollapsingList } from '../../../components/CollapsingList'
import { PageHeader } from '../../../components/PageHeader'
import styles from '../OptionList.module.css'
import { OptionSheet } from '../OptionSheet'
import { StatusSwitch } from '../StatusSwitch'
import { useOpenedOption } from '../useOpenedOption'
import { DoneCard } from './DoneCard'
import { useDoneList } from './useDoneList'

// screens.md §6: やったリスト（/done）。タブは「やりたい」のまま、ヘッダーの切り替えで来る
export function DonePage() {
  const { options, actions } = useDoneList()
  const { opened, open, close } = useOpenedOption(options)

  return (
    <>
      <PageHeader title="やったこと" center={<StatusSwitch />} />
      {options !== null && options.length === 0 && (
        <div className={styles.empty}>
          <p>🎉 を押して、やったことをここに集めよう</p>
        </div>
      )}
      {/* 最後の 1 枚が抜けるときも縮んで消えるよう、空になっても一覧は描いておく */}
      {options !== null && (
        <CollapsingList items={options} className={styles.grid}>
          {(option) => <DoneCard option={option} onOpen={open} />}
        </CollapsingList>
      )}
      <OptionSheet option={opened} onClose={close} actions={actions} />
    </>
  )
}
