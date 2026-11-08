import type { SuggestionCatalog, SuggestionSummary, Tag } from "../../../shared/types";
import type { RelatedCandidate, SuggestionBody, SuggestionStore } from "../../src/repositories/SuggestionRepository";

// メモリ上の SuggestionStore。add した順に id を振り、タグは名前から id を振る
export class FakeSuggestionStore implements SuggestionStore {
  readonly #tags: Tag[] = [];
  readonly #suggestions: SuggestionSummary[] = [];
  #candidateCalls = 0;

  // タグの名前を付けて提案を足し、振った id を返す
  add(tagNames: string[], summary: Partial<SuggestionSummary> = {}): number {
    const id = this.#suggestions.length + 1;
    const tagIds = tagNames.map((name) => this.#tagId(name)).toSorted((a, b) => a - b);
    this.#suggestions.push({
      id,
      hook: `見出し ${id}`,
      title: `提案 ${id}`,
      size: "hour",
      seasonFrom: null,
      seasonTo: null,
      themeId: 1,
      optionStatus: null,
      ...summary,
      tagIds,
    });
    return id;
  }

  async catalog(): Promise<SuggestionCatalog> {
    return { themes: [{ id: 1, name: "テーマ" }], tags: [...this.#tags], suggestions: [...this.#suggestions] };
  }

  async find(id: number): Promise<SuggestionBody | null> {
    const summary = this.#suggestions.find((s) => s.id === id);
    if (summary === undefined) return null;
    const { tagIds } = summary;
    const tags = this.#tags.filter((t) => tagIds.includes(t.id));
    return { ...summary, trivia: `豆知識 ${id}`, firstStep: `一歩 ${id}`, tags, optionId: null };
  }

  // 本物と同じく自分は含めず、順番は決めない（逆順で返して、service が並べ直すことを確かめる）
  async relatedCandidates(id: number): Promise<RelatedCandidate[]> {
    this.#candidateCalls++;
    const mine = this.#suggestions.find((s) => s.id === id);
    if (mine === undefined) return [];
    const { tagIds: myTags } = mine;
    return this.#suggestions
      .filter((s) => s.id !== id)
      .map((s) => {
        const { tagIds } = s;
        return { ...s, shared: tagIds.filter((t) => myTags.includes(t)).length };
      })
      .filter((c) => c.shared > 0)
      .toReversed();
  }

  candidateCalls(): number {
    return this.#candidateCalls;
  }

  #tagId(name: string): number {
    const found = this.#tags.find((t) => t.name === name);
    if (found !== undefined) return found.id;
    const tag = { id: this.#tags.length + 1, name };
    this.#tags.push(tag);
    return tag.id;
  }
}
