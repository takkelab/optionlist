import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveBinary } from "dbmate";

export interface Migrator {
  up(): Promise<void>;
  rollback(): Promise<void>;
  drop(): Promise<void>;
  // 空の DB を作る（すでにあれば何もしない）
  create(): Promise<void>;
}

const execFileAsync = promisify(execFile);

// マイグレーションのテスト用に dbmate を呼ぶ。schema.sql は書き出さない（npm run db:migrate だけが書き出す）
export class DbmateCli implements Migrator {
  readonly #url: string;
  readonly #migrationsDir: string;

  constructor(url: string, migrationsDir: string) {
    this.#url = url;
    this.#migrationsDir = migrationsDir;
  }

  async up(): Promise<void> {
    await this.#run("up");
  }

  async rollback(): Promise<void> {
    await this.#run("rollback");
  }

  async create(): Promise<void> {
    await this.#run("create");
  }

  async drop(): Promise<void> {
    await this.#run("drop");
  }

  async #run(command: string): Promise<void> {
    const args = ["--url", this.#url, "--migrations-dir", this.#migrationsDir, "--no-dump-schema", command];
    await execFileAsync(resolveBinary(), args);
  }
}
