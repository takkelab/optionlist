import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseEnv } from 'node:util'
import { createConnection } from 'mysql2/promise'
import type { Connection, RowDataPacket } from 'mysql2/promise'

export type SavedEvent = { type: string; payload: Record<string, unknown> }

export interface TestData {
  // マスターデータ（suggestions）以外を空にする
  reset(): Promise<void>
  // 保存された利用イベント（screens.md §8）。入った順
  events(): Promise<SavedEvent[]>
  close(): Promise<void>
}

// マスターデータ以外のテーブル。子のテーブルから並べる（backend/tests/fakes/TestDatabase.ts と同じ）
const DATA_TABLES = ['achievements', 'events', 'options']
const ENV_FILE = resolve(import.meta.dirname, '../../backend/.env.test')

// E2E の各テストの前にテスト用 DB を空にする。backend が使うのと同じ backend/.env.test の DATABASE_URL に接続する
// 通信を差し替えずに状態をそろえるため、DB を直接触る（architecture.md §2 の L3）
export class MySqlTestData implements TestData {
  #connection: Connection | null = null

  async reset(): Promise<void> {
    const connection = await this.#connect()
    await connection.query('SET FOREIGN_KEY_CHECKS = 0')
    try {
      for (const table of DATA_TABLES) await connection.query('TRUNCATE TABLE ??', [table])
    } finally {
      await connection.query('SET FOREIGN_KEY_CHECKS = 1')
    }
  }

  async events(): Promise<SavedEvent[]> {
    const connection = await this.#connect()
    const [rows] = await connection.query<RowDataPacket[]>('SELECT type, payload FROM events ORDER BY id')
    return rows.map((row) => ({ type: String(row.type), payload: row.payload as Record<string, unknown> }))
  }

  async close(): Promise<void> {
    await this.#connection?.end()
    this.#connection = null
  }

  async #connect(): Promise<Connection> {
    if (this.#connection !== null) return this.#connection
    const { DATABASE_URL: url } = parseEnv(readFileSync(ENV_FILE, 'utf8'))
    if (url === undefined) throw new Error(`${ENV_FILE} に DATABASE_URL がない`)
    this.#connection = await createConnection(url)
    return this.#connection
  }
}
