import { describe, expect, it } from 'vitest'
import { ConsultPrompt } from './ConsultPrompt'

const prompt = new ConsultPrompt()
const REST = '実現に向けて、計画を立ててください。その後はあなたが主導しつつも、相談して進めたいです。計画を立てるうえで、不明点があれば私に質問してください。'

describe('ConsultPrompt', () => {
  it('includes the title and the planned date with its weekday', () => {
    expect(prompt.build('富士山に登る', '2026-11-23')).toBe(`「富士山に登る」をやってみたいです。予定日は、2026/11/23（月）です。${REST}`)
  })

  it('leaves out the planned date when it is not decided', () => {
    expect(prompt.build('富士山に登る', null)).toBe(`「富士山に登る」をやってみたいです。${REST}`)
  })
})

describe('ConsultPrompt with the first step of a suggestion', () => {
  const ASK = 'まずは、最初の一歩を教えてください。今は「近くで雲海が見られる山や展望台を調べる」ところから始めようと思っています。わからないことがあれば、先に私に質問してください。'

  it('asks for the first step, giving the suggested one as a clue', () => {
    expect(prompt.build('雲海を見に行く', null, '近くで雲海が見られる山や展望台を調べる')).toBe(`「雲海を見に行く」をやってみたいです。${ASK}`)
  })

  it('keeps the planned date before the question', () => {
    expect(prompt.build('雲海を見に行く', '2026-11-23', '近くで雲海が見られる山や展望台を調べる')).toBe(
      `「雲海を見に行く」をやってみたいです。予定日は、2026/11/23（月）です。${ASK}`,
    )
  })
})
