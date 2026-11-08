import type { UserScopes } from "../infra/PgDatabase";

export type UserRow = { createdAt: Date; hasRecoveryCode: boolean };

// その人の users の行（自分の行だけ）
export interface UserStore {
  // 最後に使った日時を書く（1 日 1 回。api.md §6）
  touch(userId: number, now: Date): Promise<void>;
  // なければ null
  find(userId: number): Promise<UserRow | null>;
  // 復旧コードのハッシュを入れる（前のものは上書きで使えなくなる）。行がなければ false
  setRecoveryCode(userId: number, codeHash: Buffer): Promise<boolean>;
  // アカウントを消し（options・achievements は CASCADE）、付いていた写真のファイル名を返す
  remove(userId: number): Promise<string[]>;
}

type FindRow = { created_at: Date; has_recovery_code: boolean };
type PhotoRow = { photo_filename: string };

export class UserRepository implements UserStore {
  readonly #db: UserScopes;

  constructor(db: UserScopes) {
    this.#db = db;
  }

  async touch(userId: number, now: Date): Promise<void> {
    const scoped = this.#db.forUser(userId);
    await scoped.run((tx) => tx.query("UPDATE users SET last_seen_at = $2 WHERE id = $1", [userId, now]));
  }

  async find(userId: number): Promise<UserRow | null> {
    const scoped = this.#db.forUser(userId);
    const [row] = (await scoped.run((tx) =>
      tx.query("SELECT created_at, recovery_code_hash IS NOT NULL AS has_recovery_code FROM users WHERE id = $1", [userId]),
    )) as FindRow[];
    return row === undefined ? null : { createdAt: row.created_at, hasRecoveryCode: row.has_recovery_code };
  }

  async setRecoveryCode(userId: number, codeHash: Buffer): Promise<boolean> {
    const scoped = this.#db.forUser(userId);
    const rows = (await scoped.run((tx) =>
      tx.query("UPDATE users SET recovery_code_hash = $2 WHERE id = $1 RETURNING id", [userId, codeHash]),
    )) as unknown[];
    return rows.length > 0;
  }

  // 写真の名前を読むのと行を消すのを 1 つのトランザクションで行う（その間に付けた写真を取りこぼさない）
  async remove(userId: number): Promise<string[]> {
    const scoped = this.#db.forUser(userId);
    return scoped.run(async (tx) => {
      const photos = (await tx.query(
        "SELECT photo_filename FROM achievements WHERE user_id = $1 AND photo_filename IS NOT NULL FOR UPDATE",
        [userId],
      )) as PhotoRow[];
      await tx.query("DELETE FROM users WHERE id = $1", [userId]);
      return photos.map((row) => row.photo_filename);
    });
  }
}
