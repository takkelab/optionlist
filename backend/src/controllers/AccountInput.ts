import type { RestoreInput } from "../services/AccountSettingsService";
import { AppError } from "../services/errors";

export interface AccountInputParser {
  restore(body: unknown): RestoreInput;
}

// 正規化の前の長さの上限（空白・ハイフンを混ぜても 16 文字に収まる範囲。それより長いものは読まずに断る）
const MAX_CODE_INPUT = 64;

// POST /api/account/restore の入力検証（api.md §2・§4）。コードの形（data.md §3）は AccountSettingsService が正規化して確かめる
export class AccountInput implements AccountInputParser {
  restore(body: unknown): RestoreInput {
    if (typeof body !== "object" || body === null || Array.isArray(body)) throw this.#invalid("本文は JSON のオブジェクト");
    const { code, replace } = { ...body } as Record<string, unknown>;
    if (typeof code !== "string" || code.length > MAX_CODE_INPUT) throw this.#invalid("code は復旧コードの文字列");
    if (replace !== undefined && typeof replace !== "boolean") throw this.#invalid("replace は true か false");
    return { code, replace: replace === true };
  }

  #invalid(message: string): AppError {
    return new AppError("VALIDATION_ERROR", message);
  }
}
