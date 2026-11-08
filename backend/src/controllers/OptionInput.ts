import type { OptionStatus } from "../../../shared/types";
import type { NewOption, OptionPatch } from "../services/OptionService";
import { AppError } from "../services/errors";
import type { PathIdParser } from "./PathId";

export interface OptionInputParser {
  status(value: unknown): OptionStatus;
  id(value: unknown): number;
  newOption(body: unknown): NewOption;
  patch(body: unknown): OptionPatch;
  ids(body: unknown): number[];
}

const STATUSES: readonly unknown[] = ["pending", "completed"] satisfies OptionStatus[];
const TITLE_MAX = 200;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
// 受ける年は 1000〜9999 年（4 桁なので文字列のまま比べられる。DB の date はもっと広いが、API の範囲は変えない）
const DATE_MIN = "1000-01-01";

// options の API の入力検証（api.md §3、data.md §3）。違反は 400 VALIDATION_ERROR
export class OptionInput implements OptionInputParser {
  readonly #ids: PathIdParser;

  constructor(ids: PathIdParser) {
    this.#ids = ids;
  }

  status(value: unknown): OptionStatus {
    if (!this.#isStatus(value)) throw this.#invalid("status は pending か completed");
    return value;
  }

  // パスの :id。正の整数でなければ、その option は存在しないので 404
  id(value: unknown): number {
    const id = this.#ids.parse(value);
    if (id === null) throw new AppError("NOT_FOUND", `option ${String(value)} が見つからない`);
    return id;
  }

  newOption(body: unknown): NewOption {
    const { title, suggestionId } = this.#object(body);
    return { title: this.#title(title), suggestionId: suggestionId === undefined || suggestionId === null ? null : this.#suggestionId(suggestionId) };
  }

  // plannedOn は null で消す
  patch(body: unknown): OptionPatch {
    const { title, status, plannedOn } = this.#object(body);
    if ([title, status, plannedOn].every((value) => value === undefined)) {
      throw this.#invalid("title・status・plannedOn のどれかが必要");
    }
    return {
      title: title === undefined ? undefined : this.#title(title),
      status: status === undefined ? undefined : this.status(status),
      plannedOn: plannedOn === undefined || plannedOn === null ? plannedOn : this.#date(plannedOn),
    };
  }

  ids(body: unknown): number[] {
    const { ids } = this.#object(body);
    if (!Array.isArray(ids) || !ids.every((id) => this.#isPositiveInteger(id))) {
      throw this.#invalid("ids は option の ID（正の整数）の配列");
    }
    return ids;
  }

  // 前後の空白を除いて 1〜200 文字。絵文字も 1 文字に数える（コードポイント単位）
  #title(value: unknown): string {
    if (typeof value !== "string") throw this.#invalid("title は文字列");
    const title = value.trim();
    const { length } = [...title];
    if (length < 1 || length > TITLE_MAX) throw this.#invalid(`title は前後の空白を除いて 1〜${TITLE_MAX} 文字`);
    return title;
  }

  // 実在する日付の YYYY-MM-DD（2026-02-30 などは不可）
  #date(value: unknown): string {
    const invalid = this.#invalid("plannedOn は実在する日付の YYYY-MM-DD");
    if (typeof value !== "string" || !DATE_PATTERN.test(value) || value < DATE_MIN) throw invalid;
    // 存在しない日（2月30日など）は Date が繰り上げるか読めないので、書き戻して同じになるかで確かめる
    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw invalid;
    return value;
  }

  // suggestions.id は BIGINT なので、safe integer ならどれも SQL に渡せる（ない ID は外部キー違反で 404）
  #suggestionId(value: unknown): number {
    if (!this.#isPositiveInteger(value)) throw this.#invalid("suggestionId は提案の ID（正の整数）");
    return value;
  }

  #object(body: unknown): Record<string, unknown> {
    if (typeof body !== "object" || body === null || Array.isArray(body)) throw this.#invalid("本文は JSON のオブジェクト");
    return { ...body };
  }

  #isStatus(value: unknown): value is OptionStatus {
    return STATUSES.includes(value);
  }

  #isPositiveInteger(value: unknown): value is number {
    return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
  }

  #invalid(message: string): AppError {
    return new AppError("VALIDATION_ERROR", message);
  }
}
