import type { LogEntry, Logger } from "../middleware/Middleware";

// 1 行の出し先。server.ts は標準出力・標準エラー、テストは書いた行を覚えるフェイク
export interface LineWriter {
  out(line: string): void;
  err(line: string): void;
}

export class ProcessLineWriter implements LineWriter {
  out(line: string): void {
    const { stdout } = process;
    stdout.write(`${line}\n`);
  }

  err(line: string): void {
    const { stderr } = process;
    stderr.write(`${line}\n`);
  }
}

type Severity = "INFO" | "ERROR";
type ErrorFields = { name: string; message: string; code?: string; stack?: string };

const REDACTED = "[redacted]";
// 伏せる形（docs/decisions/0050）。Cookie は名前つきの値と、鍵そのもの（32 バイトの base64url ＝ 43 文字）。
// 復旧コードは 4 文字 × 4。区切りは、入力の正規化（RecoveryCodes.normalize）が除くもの（空白・ハイフン・全角のハイフンと長音）が
// いくつ混ざっていてもよい（正規化の前の形も伏せる）。英単語 4 つの並びなども伏せてしまうが、漏らすよりよい
const SEPARATOR = "[\\s\\-‐－ー]*";
const SECRETS = [
  /((?:__Host-)?ol_session=)[^;\s"]*/g,
  /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/g,
  new RegExp(`(?<![A-Za-z0-9])[A-Za-z0-9]{4}(?:${SEPARATOR}[A-Za-z0-9]{4}){3}(?![A-Za-z0-9])`, "g"),
];

// 1 行 1 つの JSON のログ（severity・message・kind・route・status・durationMs。docs/decisions/0042）
// error は name・message・code・stack だけにする（pg のエラーの detail には行の中身〈タイトル〉が入るため捨てる）
export class JsonLogger implements Logger {
  readonly #writer: LineWriter;

  constructor(writer: LineWriter) {
    this.#writer = writer;
  }

  error(entry: LogEntry): void {
    this.#writer.err(this.#line("ERROR", entry));
  }

  info(entry: LogEntry): void {
    this.#writer.out(this.#line("INFO", entry));
  }

  #line(severity: Severity, entry: LogEntry): string {
    const { kind, message, error, route, status, durationMs } = entry;
    const fields = { severity, message: this.#redact(message), kind, route, status, durationMs };
    const line = error === undefined ? fields : { ...fields, error: this.#error(error) };
    return JSON.stringify(line);
  }

  #error(error: unknown): ErrorFields {
    if (!(error instanceof Error)) return { name: "NonError", message: this.#redact(String(error)) };
    const fields: ErrorFields = { name: error.name, message: this.#redact(error.message) };
    if ("code" in error && typeof error.code === "string") fields.code = error.code;
    if (error.stack !== undefined) fields.stack = this.#redact(error.stack);
    return fields;
  }

  #redact(text: string): string {
    return SECRETS.reduce((result, pattern) => result.replace(pattern, (match, prefix: unknown) => {
      return typeof prefix === "string" && prefix.endsWith("=") ? `${prefix}${REDACTED}` : REDACTED;
    }), text);
  }
}
