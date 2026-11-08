import type { SuggestionCatalog, SuggestionDetail } from "../../../shared/types";
import type { RelatedCandidate, SuggestionStores } from "../repositories/SuggestionRepository";
import { AppError } from "./errors";

// userId はその人のアカウント（null ならアカウントがない人。optionStatus・optionId は全部 null）
export interface SuggestionUseCases {
  catalog(userId: number | null): Promise<SuggestionCatalog>;
  detail(userId: number | null, id: number): Promise<SuggestionDetail>;
}

const RELATED_MAX = 5;

// 提案の処理。関連はタグを共有する提案を、共有するタグの多い順（同じなら id 順）に最大 5 件（api.md §2）
export class SuggestionService implements SuggestionUseCases {
  readonly #stores: SuggestionStores;

  constructor(stores: SuggestionStores) {
    this.#stores = stores;
  }

  catalog(userId: number | null): Promise<SuggestionCatalog> {
    return this.#stores.withUser(userId, (store) => store.catalog());
  }

  detail(userId: number | null, id: number): Promise<SuggestionDetail> {
    return this.#stores.withUser(userId, async (store) => {
      const body = await store.find(id);
      if (body === null) throw new AppError("NOT_FOUND", `suggestion ${id} が見つからない`);
      const related = this.#related(await store.relatedCandidates(id));
      return { ...body, related };
    });
  }

  // 候補に自分は入っていない（SuggestionStore.relatedCandidates）
  #related(candidates: RelatedCandidate[]): SuggestionDetail["related"] {
    return candidates
      .toSorted((a, b) => b.shared - a.shared || a.id - b.id)
      .slice(0, RELATED_MAX)
      .map(({ shared: _shared, ...summary }) => summary);
  }
}
