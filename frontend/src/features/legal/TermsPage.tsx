import { LegalPage } from './LegalPage'
import type { LegalSection } from './LegalPage'
import { LEGAL_INFO } from './legalInfo'

// 利用規約（/terms。screens.md §10）。書く項目は docs/decisions/0039
const SECTIONS: readonly LegalSection[] = [
  {
    heading: 'はじめに',
    paragraphs: [
      `この利用規約は、${LEGAL_INFO.operator}（以下「運営者」）が提供する OptionList（以下「本アプリ」）の使い方を定めるものです。本アプリを使うときは、この規約に同意したものとします。`,
    ],
  },
  {
    heading: '料金',
    paragraphs: ['本アプリは無料で使えます。'],
  },
  {
    heading: '本アプリを変える・止めるとき',
    paragraphs: ['運営者は、予告なく本アプリの内容を変えたり、提供を止めたりすることがあります。'],
  },
  {
    heading: 'データと責任の範囲',
    paragraphs: [
      '運営者はバックアップを取っていますが、障害などで保存したデータが失われることがあります。',
      '運営者に故意または重大な過失がある場合を除き、データが失われたことや、本アプリを使えなかったことで生じた損害について、運営者は責任を負いません。',
    ],
  },
  {
    heading: '復旧コード',
    paragraphs: [
      '復旧コードを知っている人は、誰でもそのリストを開けます。人に見せず、ご自身で管理してください。',
    ],
  },
  {
    heading: '禁止すること',
    paragraphs: [
      'ほかの人が写った写真や、ほかの人が権利を持つ写真を、その人の許しなく保存すること。',
      '本アプリやサーバーに不正にアクセスすること、本アプリの動作を妨げること。',
      '法令や公序良俗に反すること。',
    ],
  },
  {
    heading: '従う法律',
    paragraphs: ['この規約は、日本の法律に従って解釈します。'],
  },
  {
    heading: 'この規約を変えるとき',
    paragraphs: ['この規約を変えるときは、このページでお知らせします。'],
  },
]

export function TermsPage() {
  return <LegalPage title="利用規約" sections={SECTIONS} />
}
