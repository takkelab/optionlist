import type { Database } from "../infra/PgDatabase";
import type { CleanupStore, ExpiredAccounts } from "./CleanupJob";

// 削除のジョブの SQL（data.md §5）。ol_cleanup（CLEANUP_DATABASE_URL）で接続する。ol_cleanup は SELECT・DELETE だけを持ち、
// ポリシーは USING (true) なので、全員の行に効く（data.md §4。architecture.md §2 の L13 の許可リストの jobs/）
// 境目は「期限ちょうどは残す」（<）。$1 はジョブの開始時刻（docs/decisions/0059）

// 1 本の文で消し、消した人の写真の名前を同じ文で読む。データを変える CTE の外側は文の前のスナップショットを見るので、
// CASCADE で消える前の achievements が読める。FOR UPDATE は使わない（RLS の UPDATE のポリシーが当たり、UPDATE を持たない
// ol_cleanup では読めない）。DELETE の WHERE が行を消す時点で条件を見直すので、途中で使い始めた人は消えない
const DELETE_EXPIRED_ACCOUNTS = `
  WITH deleted AS (
    DELETE FROM users u
     WHERE u.last_seen_at < $1::timestamptz - interval '5 years'
        OR (u.last_seen_at < $1::timestamptz - interval '30 days'
            AND NOT EXISTS (SELECT 1 FROM options o WHERE o.user_id = u.id)
            AND NOT EXISTS (SELECT 1 FROM achievements a WHERE a.user_id = u.id))
    RETURNING u.id, u.last_seen_at < $1::timestamptz - interval '5 years' AS inactive
  )
  SELECT (SELECT count(*) FROM deleted WHERE inactive)::int AS inactive,
         (SELECT count(*) FROM deleted WHERE NOT inactive)::int AS empty,
         ARRAY(SELECT a.photo_filename FROM achievements a
                WHERE a.user_id IN (SELECT id FROM deleted) AND a.photo_filename IS NOT NULL) AS photo_filenames`;

const DELETE_EVENTS = `
  WITH deleted AS (DELETE FROM events WHERE received_at < $1::timestamptz - interval '90 days' RETURNING 1)
  SELECT count(*)::int AS count FROM deleted`;

const DELETE_AUTH_ATTEMPTS = `
  WITH deleted AS (DELETE FROM auth_attempts WHERE occurred_at < $1::timestamptz - interval '7 days' RETURNING 1)
  SELECT count(*)::int AS count FROM deleted`;

const REFERENCED_PHOTOS = "SELECT photo_filename FROM achievements WHERE photo_filename = ANY($1::varchar[])";

type AccountsRow = { inactive: number; empty: number; photo_filenames: string[] };
type CountRow = { count: number };
type PhotoRow = { photo_filename: string };

export class CleanupRepository implements CleanupStore {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  async deleteExpiredAccounts(now: Date): Promise<ExpiredAccounts> {
    const [row] = (await this.#db.query(DELETE_EXPIRED_ACCOUNTS, [now])) as AccountsRow[];
    if (row === undefined) throw new Error("アカウントの削除の結果が返らなかった");
    return { inactive: row.inactive, empty: row.empty, photoFilenames: row.photo_filenames };
  }

  deleteOldEvents(now: Date): Promise<number> {
    return this.#count(DELETE_EVENTS, now);
  }

  deleteOldAuthAttempts(now: Date): Promise<number> {
    return this.#count(DELETE_AUTH_ATTEMPTS, now);
  }

  async referencedPhotos(filenames: string[]): Promise<string[]> {
    if (filenames.length === 0) return [];
    const rows = (await this.#db.query(REFERENCED_PHOTOS, [filenames])) as PhotoRow[];
    return rows.map((row) => row.photo_filename);
  }

  async #count(sql: string, now: Date): Promise<number> {
    const [row] = (await this.#db.query(sql, [now])) as CountRow[];
    return row?.count ?? 0;
  }
}
