import { PlannedDateLabel } from './PlannedDateLabel'

export interface ConsultPromptBuilder {
  // タイトルと予定日（未定なら null）から相談文を作る。提案から追加した項目は、提案の最初の一歩（なければ null）も渡す
  build(title: string, plannedOn: string | null, firstStep?: string | null): string
}

const dates = new PlannedDateLabel()

// screens.md §3 の相談文 ※仮決め
// - ふつうの項目（AI に相談）: まず計画を立ててもらい、その後は AI の主導で相談しながら進める
// - 提案から追加した項目（AI に聞く）: 最初の一歩を聞き、提案の最初の一歩を手がかりに添える（docs/decisions/0025）
export class ConsultPrompt implements ConsultPromptBuilder {
  build(title: string, plannedOn: string | null, firstStep: string | null = null): string {
    const plan = plannedOn === null ? '' : `予定日は、${dates.long(plannedOn)}です。`
    if (firstStep !== null) {
      return `「${title}」をやってみたいです。${plan}まずは、最初の一歩を教えてください。今は「${firstStep}」ところから始めようと思っています。わからないことがあれば、先に私に質問してください。`
    }
    return `「${title}」をやってみたいです。${plan}実現に向けて、計画を立ててください。その後はあなたが主導しつつも、相談して進めたいです。計画を立てるうえで、不明点があれば私に質問してください。`
  }
}
