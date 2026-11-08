import type { Achievement, Option, OptionStatus } from "../../../shared/types";

// SELECT の行（列は snake_case）。日時は mysql2 が Date で返す（timezone: "Z" なので UTC）
// 予定日（DATE）は Date にするとタイムゾーンでずれうるので、SQL で YYYY-MM-DD の文字列にして読む
export type OptionRow = {
  id: number;
  title: string;
  status: OptionStatus;
  suggestion_id: number | null;
  planned_on: string | null;
  achievement_count: number;
  latest_photo_filename: string | null;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

export type AchievementRow = { id: number; option_id: number; achieved_at: Date; photo_filename: string | null };

// 写真の配信先（api.md §5。/api の下なので、開発時の Vite のプロキシをそのまま通る）
const PHOTO_PATH = "/api/photos";

export interface RowMapper {
  option(row: OptionRow): Option;
  achievement(row: AchievementRow): Achievement;
}

// 行を API の型（api.md §4。camelCase、日時は ISO 8601）に変える
export class OptionRowMapper implements RowMapper {
  option(row: OptionRow): Option {
    const { completed_at: completedAt, created_at: createdAt, updated_at: updatedAt } = row;
    return {
      id: row.id,
      title: row.title,
      status: row.status,
      suggestionId: row.suggestion_id,
      plannedOn: row.planned_on,
      // COUNT(*) は BIGINT なので、ドライバの設定によっては文字列で返る
      achievementCount: Number(row.achievement_count),
      latestPhotoUrl: this.#photoUrl(row.latest_photo_filename),
      completedAt: completedAt === null ? null : completedAt.toISOString(),
      createdAt: createdAt.toISOString(),
      updatedAt: updatedAt.toISOString(),
    };
  }

  achievement(row: AchievementRow): Achievement {
    const { achieved_at: achievedAt } = row;
    return { id: row.id, optionId: row.option_id, achievedAt: achievedAt.toISOString(), photoUrl: this.#photoUrl(row.photo_filename) };
  }

  #photoUrl(filename: string | null): string | null {
    return filename === null ? null : `${PHOTO_PATH}/${filename}`;
  }
}
