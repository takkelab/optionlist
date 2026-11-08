import type { SuggestionCatalog, SuggestionSummary, Tag, Theme } from "../../../shared/types";
import type { Database } from "../infra/PgDatabase";
import type { SuggestionMapper, SuggestionSummaryRow } from "./SuggestionRowMapper";

// 提案 1 件のうち、関連を除いたもの
export type SuggestionBody = SuggestionSummary & { trivia: string; firstStep: string; tags: Tag[]; optionId: number | null };

// 関連の候補。shared はこの提案と共有するタグの数
export type RelatedCandidate = SuggestionSummary & { shared: number };

export interface SuggestionStore {
  catalog(): Promise<SuggestionCatalog>;
  find(id: number): Promise<SuggestionBody | null>;
  // タグを 1 つ以上共有する、ほかの提案（順番は決めない）
  relatedCandidates(id: number): Promise<RelatedCandidate[]>;
}

// 提案から追加した option の状態は LEFT JOIN で付け、タグの ID は相関サブクエリでまとめて読む（N+1 にしない）
const SUMMARY_COLUMNS = `s.id, s.hook, s.title, s.size, s.season_from, s.season_to, s.theme_id, o.status AS option_status,
  (SELECT string_agg(st.tag_id::text, ',' ORDER BY st.tag_id) FROM suggestion_tags st WHERE st.suggestion_id = s.id) AS tag_ids`;
const WITH_OPTION = "suggestions s LEFT JOIN options o ON o.suggestion_id = s.id";

type BodyRow = SuggestionSummaryRow & { trivia: string; first_step: string; option_id: number | null };
type CandidateRow = SuggestionSummaryRow & { shared: number };

// themes・tags・suggestions・suggestion_tags の SQL。一覧も 1 件も 3 本で読む（metrics.md §4）
export class SuggestionRepository implements SuggestionStore {
  readonly #db: Database;
  readonly #mapper: SuggestionMapper;

  constructor(db: Database, mapper: SuggestionMapper) {
    this.#db = db;
    this.#mapper = mapper;
  }

  async catalog(): Promise<SuggestionCatalog> {
    const themes = (await this.#db.query("SELECT id, name FROM themes ORDER BY sort_order, id")) as Theme[];
    const tags = (await this.#db.query("SELECT id, name FROM tags ORDER BY id")) as Tag[];
    const rows = (await this.#db.query(`SELECT ${SUMMARY_COLUMNS} FROM ${WITH_OPTION} ORDER BY s.id`)) as SuggestionSummaryRow[];
    return { themes, tags, suggestions: rows.map((row) => this.#mapper.summary(row)) };
  }

  async find(id: number): Promise<SuggestionBody | null> {
    const rows = (await this.#db.query(`SELECT ${SUMMARY_COLUMNS}, s.trivia, s.first_step, o.id AS option_id FROM ${WITH_OPTION} WHERE s.id = $1`, [
      id,
    ])) as BodyRow[];
    const [row] = rows;
    if (row === undefined) return null;
    const tags = (await this.#db.query(
      "SELECT t.id, t.name FROM suggestion_tags st JOIN tags t ON t.id = st.tag_id WHERE st.suggestion_id = $1 ORDER BY t.id",
      [id],
    )) as Tag[];
    return { ...this.#mapper.summary(row), trivia: row.trivia, firstStep: row.first_step, tags, optionId: row.option_id };
  }

  async relatedCandidates(id: number): Promise<RelatedCandidate[]> {
    const rows = (await this.#db.query(
      `SELECT ${SUMMARY_COLUMNS}, COUNT(*) AS shared
         FROM suggestion_tags mine
         JOIN suggestion_tags other ON other.tag_id = mine.tag_id AND other.suggestion_id <> mine.suggestion_id
         JOIN ${WITH_OPTION} ON s.id = other.suggestion_id
        WHERE mine.suggestion_id = $1
        GROUP BY s.id, o.status`,
      [id],
    )) as CandidateRow[];
    // COUNT(*) は BIGINT なので、ドライバの設定によっては文字列で返る
    return rows.map((row) => ({ ...this.#mapper.summary(row), shared: Number(row.shared) }));
  }
}
