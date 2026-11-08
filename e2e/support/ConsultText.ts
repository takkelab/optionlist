export interface ConsultTextSource {
  // 相談文（screens.md §3）。longDate は「2026/11/23（月）」、未定なら null
  prompt(title: string, longDate: string | null): string
}

// E2E で確かめる「AI に相談」の相談文
export class ConsultText implements ConsultTextSource {
  prompt(title: string, longDate: string | null): string {
    const plan = longDate === null ? '' : `予定日は、${longDate}です。`
    return `「${title}」をやってみたいです。${plan}実現に向けて、計画を立ててください。その後はあなたが主導しつつも、相談して進めたいです。計画を立てるうえで、不明点があれば私に質問してください。`
  }
}
