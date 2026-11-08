import type { OptionStatus, SuggestionSize } from '../../../shared/types'

export interface SuggestionLabeler {
  // 一歩の大きさのチップの並び（小さい順）
  sizes(): SuggestionSize[]
  size(size: SuggestionSize): string
  // 「11〜12 月」。1 か月だけなら「12 月」。通年（null）なら出さないので null
  season(from: number | null, to: number | null): string | null
  // 今月のおすすめのカードの「11 月まで」。通年（null）なら null
  until(to: number | null): string | null
  // 一覧の行の印。追加していなければ null
  mark(status: OptionStatus | null): string | null
  // テーマの色の番号（1〜10。tokens.css の --deco-1〜10）。id 1〜10 を順に当て、11 からはまた 1 に戻る
  colorSlot(themeId: number): number
}

const DECO_COLORS = 10

const SIZE_LABELS: Record<SuggestionSize, string> = {
  hour: '1 時間以内',
  half_day: '半日',
  day: '1 日',
  overnight: '泊まり',
}

const MARKS: Record<OptionStatus, string> = { pending: '追加済み', completed: 'やった' }

// 提案の画面に出す言葉（screens.md §5）
export class SuggestionLabels implements SuggestionLabeler {
  sizes(): SuggestionSize[] {
    return ['hour', 'half_day', 'day', 'overnight']
  }

  size(size: SuggestionSize): string {
    return SIZE_LABELS[size]
  }

  season(from: number | null, to: number | null): string | null {
    if (from === null || to === null) return null
    return from === to ? `${from} 月` : `${from}〜${to} 月`
  }

  until(to: number | null): string | null {
    return to === null ? null : `${to} 月まで`
  }

  mark(status: OptionStatus | null): string | null {
    return status === null ? null : MARKS[status]
  }

  colorSlot(themeId: number): number {
    return ((themeId - 1) % DECO_COLORS + DECO_COLORS) % DECO_COLORS + 1
  }
}
