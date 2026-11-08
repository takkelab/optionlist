import type { CommandResult, CommandRunner, FileSource } from "../lib/types.ts";

// パス → 中身 の対応で動くファイル置き場
export class FakeFileSource implements FileSource {
  readonly #files: Map<string, string>;

  constructor(files: Record<string, string>) {
    this.#files = new Map(Object.entries(files));
  }

  list(dirs: string[], extensions: string[]): string[] {
    return [...this.#files.keys()].filter(
      (path) => dirs.some((dir) => path.startsWith(`${dir}/`)) && extensions.some((ext) => path.endsWith(ext)),
    );
  }

  exists(path: string): boolean {
    return this.#files.has(path);
  }

  read(path: string): string {
    const text = this.#files.get(path);
    if (text === undefined) throw new Error(`no such file: ${path}`);
    return text;
  }
}

// コマンドの部分一致 → 結果 の対応で動く。実行したコマンドを記録する
export class FakeCommandRunner implements CommandRunner {
  readonly #results: [string, Partial<CommandResult>][];
  readonly #executed: string[] = [];

  constructor(results: [string, Partial<CommandResult>][]) {
    this.#results = results;
  }

  run(command: string): CommandResult {
    this.#executed.push(command);
    const found = this.#results.find(([pattern]) => command.includes(pattern));
    return { exitCode: 0, output: "", durationSec: 1, ...found?.[1] };
  }

  executed(): string[] {
    return [...this.#executed];
  }
}

// 1 つのパスについて、read するたびに次の中身を返す（最後の中身はそのまま返し続ける）。測り直しのテスト用
export class SequenceFileSource implements FileSource {
  readonly #path: string;
  readonly #contents: string[];
  #reads = 0;

  constructor(path: string, contents: string[]) {
    this.#path = path;
    this.#contents = contents;
  }

  list(): string[] {
    return [this.#path];
  }

  exists(path: string): boolean {
    return path === this.#path && this.#contents.length > 0;
  }

  read(path: string): string {
    if (path !== this.#path) throw new Error(`no such file: ${path}`);
    const text = this.#contents[Math.min(this.#reads, this.#contents.length - 1)] ?? "";
    this.#reads++;
    return text;
  }
}
