import type { SuggestionCatalog, SuggestionDetail } from "../../../shared/types";
import type { RelatedCandidate, SuggestionStore } from "../repositories/SuggestionRepository";
import { AppError } from "./errors";

export interface SuggestionUseCases {
  catalog(): Promise<SuggestionCatalog>;
  detail(id: number): Promise<SuggestionDetail>;
}

const RELATED_MAX = 5;

// 提案の処理。関連はタグを共有する提案を、共有するタグの多い順（同じなら id 順）に最大 5 件（api.md §2）
export class SuggestionService implements SuggestionUseCases {
  readonly #store: SuggestionStore;

  constructor(store: SuggestionStore) {
    this.#store = store;
  }

  catalog(): Promise<SuggestionCatalog> {
    return this.#store.catalog();
  }

  async detail(id: number): Promise<SuggestionDetail> {
    const body = await this.#store.find(id);
    if (body === null) throw new AppError("NOT_FOUND", `suggestion ${id} が見つからない`);
    const related = this.#related(await this.#store.relatedCandidates(id));
    return { ...body, related };
  }

  // 候補に自分は入っていない（SuggestionStore.relatedCandidates）
  #related(candidates: RelatedCandidate[]): SuggestionDetail["related"] {
    return candidates
      .toSorted((a, b) => b.shared - a.shared || a.id - b.id)
      .slice(0, RELATED_MAX)
      .map(({ shared: _shared, ...summary }) => summary);
  }
}
