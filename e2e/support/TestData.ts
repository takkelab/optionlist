import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseEnv } from 'node:util'
import pg from 'pg'

export type SavedEvent = { type: string; payload: Record<string, unknown> }

export interface TestData {
  // マスターデータ（suggestions）以外を空にする
  reset(): Promise<void>
  // 保存された利用イベント（screens.md §8）。入った順
  events(): Promise<SavedEvent[]>
  close(): Promise<void>
}

// マスターデータ以外のテーブル（backend/tests/fakes/TestDatabase.ts と同じ）
const DATA_TABLES = ['achievements', 'events', 'options']
const ENV_FILE = resolve(import.meta.dirname, '../../backend/.env.test')

// E2E の各テストの前にテスト用 DB を空にする。backend が使うのと同じ backend/.env.test の DATABASE_URL に接続する
// 通信を差し替えずに状態をそろえるため、DB を直接触る（architecture.md §2 の L3）
export class PgTestData implements TestData {
  #client: pg.Client | null = null

  async reset(): Promise<void> {
    const client = await this.#connect()
    await client.query(`TRUNCATE TABLE ${DATA_TABLES.join(', ')} RESTART IDENTITY`)
  }

  async events(): Promise<SavedEvent[]> {
    const client = await this.#connect()
    const { rows } = await client.query<SavedEvent>('SELECT type, payload FROM events ORDER BY id')
    return rows.map((row) => ({ type: String(row.type), payload: row.payload }))
  }

  async close(): Promise<void> {
    await this.#client?.end()
    this.#client = null
  }

  async #connect(): Promise<pg.Client> {
    if (this.#client !== null) return this.#client
    const { DATABASE_URL: url } = parseEnv(readFileSync(ENV_FILE, 'utf8'))
    if (url === undefined) throw new Error(`${ENV_FILE} に DATABASE_URL がない`)
    const client = new pg.Client({ connectionString: url })
    await client.connect()
    this.#client = client
    return client
  }
}
