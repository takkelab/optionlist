import type { LogEntry, Logger } from "../../src/middleware/Middleware";

// ログを console に出さずに覚えておく
export class FakeLogger implements Logger {
  readonly #entries: LogEntry[] = [];
  readonly #infos: LogEntry[] = [];

  error(entry: LogEntry): void {
    this.#entries.push(entry);
  }

  info(entry: LogEntry): void {
    this.#infos.push(entry);
  }

  // error で渡されたエラー（渡されなかった行は除く）
  errors(): unknown[] {
    return this.#entries.flatMap((entry) => ("error" in entry ? [entry.error] : []));
  }

  entries(): LogEntry[] {
    return [...this.#entries];
  }
}
