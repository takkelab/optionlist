import type { AccountStatus, RecoveryCode } from "../../../shared/types";
import type { AccountStore } from "../repositories/AccountRepository";
import type { UserStore } from "../repositories/UserRepository";
import type { Hasher } from "./AccountHasher";
import type { SessionKeySource, StartedAccount } from "./AccountService";
import { AppError } from "./errors";
import type { FailureLog, PhotoRemover } from "./PhotoCleanup";
import type { RecoveryCodeSource } from "./RecoveryCodes";

export type RestoreInput = { code: string; replace: boolean };

// 設定のシートの操作（api.md §2・§6、screens.md §9）。userId はセッションの middleware が決めた人（null はアカウントがない人）
export interface AccountUseCases {
  status(userId: number | null): Promise<AccountStatus>;
  // アカウントがなければ 404
  issueRecoveryCode(userId: number | null): Promise<RecoveryCode>;
  // 移った先の人と、Cookie に入れる新しい鍵
  restore(userId: number | null, ip: string, input: RestoreInput): Promise<StartedAccount>;
  // アカウントがなくても成功
  removeAll(userId: number | null): Promise<void>;
}

export type AccountSettingsDeps = {
  accounts: AccountStore;
  users: UserStore;
  photos: PhotoRemover;
  keys: SessionKeySource;
  codes: RecoveryCodeSource;
  hasher: Hasher;
  log: FailureLog;
};

const NO_ACCOUNT: AccountStatus = { hasAccount: false, hasRecoveryCode: false, createdAt: null };

export class AccountSettingsService implements AccountUseCases {
  readonly #accounts: AccountStore;
  readonly #users: UserStore;
  readonly #photos: PhotoRemover;
  readonly #keys: SessionKeySource;
  readonly #codes: RecoveryCodeSource;
  readonly #hasher: Hasher;
  readonly #log: FailureLog;

  constructor(deps: AccountSettingsDeps) {
    this.#log = deps.log;
    this.#accounts = deps.accounts;
    this.#users = deps.users;
    this.#photos = deps.photos;
    this.#keys = deps.keys;
    this.#codes = deps.codes;
    this.#hasher = deps.hasher;
  }

  async status(userId: number | null): Promise<AccountStatus> {
    if (userId === null) return NO_ACCOUNT;
    const found = await this.#users.find(userId);
    if (found === null) return NO_ACCOUNT;
    const { hasRecoveryCode, createdAt } = found;
    return { hasAccount: true, hasRecoveryCode, createdAt: createdAt.toISOString() };
  }

  // 平文はこの応答でだけ返し、DB にはハッシュだけを入れる（作り直すと前のコードは使えなくなる）
  async issueRecoveryCode(userId: number | null): Promise<RecoveryCode> {
    const code = this.#codes.next();
    const normalized = this.#codes.normalize(code);
    if (normalized === null) throw new Error(`作った復旧コードの形が違う: ${code.length} 文字`);
    const saved = userId !== null && (await this.#users.setRecoveryCode(userId, this.#hasher.sha256(normalized)));
    if (!saved) throw new AppError("NOT_FOUND", "アカウントがない");
    return { code };
  }

  // 移ったあと、今の端末に別のアカウントがあれば消す（誰も開けなくなるため。自分のコードを自分の端末で入れたときは消さない）
  async restore(userId: number | null, ip: string, input: RestoreInput): Promise<StartedAccount> {
    const normalized = this.#codes.normalize(input.code);
    if (normalized === null) throw new AppError("VALIDATION_ERROR", "復旧コードの形が違う");
    const sessionKey = this.#keys.next();
    const result = await this.#accounts.restore({
      codeHash: this.#hasher.sha256(normalized),
      newSessionHash: this.#hasher.sha256(sessionKey),
      ipHash: this.#hasher.ip(ip),
      currentUserId: userId,
      replace: input.replace,
    });
    if (result.status === "not_found") throw new AppError("NOT_FOUND", "復旧コードが違う");
    if (result.status === "rate_limited") {
      throw new AppError("TOO_MANY_REQUESTS", "復旧コードを入れる回数が多すぎる。しばらく待ってからやり直す", result.retryAfterSeconds);
    }
    if (result.status === "needs_confirm") {
      throw new AppError("CONFLICT", "この端末のデータが消えるので、確認してから replace を付けて送り直す", null, {
        localItemCount: result.localItemCount,
      });
    }
    if (userId !== null && userId !== result.userId) await this.#removeOld(userId);
    return { userId: result.userId, sessionKey };
  }

  // auth_restore はもう確定していて、移った先の鍵は置き換わっている。ここで投げると新しい鍵の Cookie が返らず、
  // 移った先のアカウントがどの端末からも開けなくなるので、古いアカウントを消せなくても成功にしてログに残す（docs/decisions/0049）。
  // 残った古いアカウントは、誰も開けない（鍵を持つ端末がない）まま、削除のジョブ（data.md §5）が保存期間で消す
  async #removeOld(userId: number): Promise<void> {
    try {
      await this.removeAll(userId);
    } catch (error) {
      this.#log.error(`引き継ぐ前のアカウント ${userId} を消せなかった`, error);
    }
  }

  // 行を消してからファイルを消す（ファイルを消せなくても成功のまま。PhotoCleanup。data.md §5）
  async removeAll(userId: number | null): Promise<void> {
    if (userId === null) return;
    const photos = await this.#users.remove(userId);
    await this.#photos.remove(photos);
  }
}
