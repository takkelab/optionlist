import type { OptionStatus, SuggestionSize, SuggestionSummary } from "../../../shared/types";

// 一覧の行に出す列（列は snake_case）。tag_ids は string_agg で「1,2,3」の形にまとめて読む（タグがなければ null）
export type SuggestionSummaryRow = {
  id: number;
  hook: string;
  title: string;
  size: SuggestionSize;
  season_from: number | null;
  season_to: number | null;
  theme_id: number;
  option_status: OptionStatus | null;
  tag_ids: string | null;
};

export interface SuggestionMapper {
  summary(row: SuggestionSummaryRow): SuggestionSummary;
}

// 行を API の型（api.md §4。camelCase）に変える
export class SuggestionRowMapper implements SuggestionMapper {
  summary(row: SuggestionSummaryRow): SuggestionSummary {
    const { tag_ids: tagIds } = row;
    return {
      id: row.id,
      hook: row.hook,
      title: row.title,
      size: row.size,
      seasonFrom: row.season_from,
      seasonTo: row.season_to,
      themeId: row.theme_id,
      tagIds: tagIds === null ? [] : tagIds.split(",").map(Number),
      optionStatus: row.option_status,
    };
  }
}
