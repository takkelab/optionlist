// gcloud を呼ぶ（infra/setup.ts・scripts/infra-check.ts）
// Windows の gcloud は gcloud.cmd なので shell 経由で動かす。cmd.exe の引用の規則で CEL の式（' や && を含む）が壊れないよう、
// 値のあるフラグは --flags-file（JSON）で渡し、コマンドラインには記号のない位置引数と真偽のフラグだけを書く
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type FlagValue = string | number | boolean | Record<string, string>;
export type Flags = Record<string, FlagValue>;
export type GcloudResult = { ok: boolean; stdout: string; stderr: string };

export interface Gcloud {
  // 読むだけ。失敗は ok=false で返す（ないものの describe など）
  read(args: string[], flags?: Flags): GcloudResult;
  // 変える。何をするかを表示してから流し、失敗したら止まる。input は標準入力（秘密の値をコマンドラインに出さない）
  change(args: string[], flags?: Flags, input?: string): GcloudResult;
}

const SAFE = /^[A-Za-z0-9_.:/@=,+\-]+$/;
// 画面に出さないフラグ（値は flags-file の一時ファイルだけに書く）
const HIDDEN_FLAGS = new Set(["password"]);

export const describeCommand = (args: string[], flags: Flags = {}): string => {
  const shown = Object.entries(flags).map(([name, value]) => {
    if (typeof value === "boolean") return value ? `--${name}` : `--no-${name}`;
    if (HIDDEN_FLAGS.has(name)) return `--${name}=（伏せる）`;
    return `--${name}=${typeof value === "object" ? JSON.stringify(value) : value}`;
  });
  return ["gcloud", ...args, ...shown].join(" ");
};

export class CliGcloud implements Gcloud {
  readonly #dryRun: boolean;

  constructor(dryRun: boolean) {
    this.#dryRun = dryRun;
  }

  read(args: string[], flags: Flags = {}): GcloudResult {
    return this.#run(args, flags, undefined);
  }

  change(args: string[], flags: Flags = {}, input?: string): GcloudResult {
    console.log(`▶ ${describeCommand(args, flags)}${input === undefined ? "" : "（標準入力から値を渡す）"}`);
    if (this.#dryRun) return { ok: true, stdout: "", stderr: "" };
    const result = this.#run(args, flags, input);
    if (!result.ok) throw new Error(`gcloud が失敗した: ${describeCommand(args, flags)}\n${result.stderr}`);
    return result;
  }

  #run(args: string[], flags: Flags, input: string | undefined): GcloudResult {
    for (const arg of args) if (!SAFE.test(arg)) throw new Error(`位置引数に記号がある（--flags-file で渡す）: ${arg}`);
    const line = ["gcloud", ...args, "--quiet"];
    const fileFlags: Record<string, string | number | Record<string, string>> = {};
    for (const [name, value] of Object.entries(flags)) {
      if (typeof value === "boolean") line.push(value ? `--${name}` : `--no-${name}`);
      else fileFlags[`--${name}`] = value;
    }
    const dir = mkdtempSync(join(tmpdir(), "optionlist-gcloud-"));
    try {
      if (Object.keys(fileFlags).length > 0) {
        const file = join(dir, "flags.json");
        writeFileSync(file, JSON.stringify(fileFlags));
        line.push(`--flags-file=${file}`);
      }
      const result = spawnSync(line.map((part) => (part.includes(" ") ? `"${part}"` : part)).join(" "), {
        shell: true,
        encoding: "utf8",
        input,
        maxBuffer: 64 * 1024 * 1024,
      });
      if (result.error !== undefined) throw result.error;
      return { ok: result.status === 0, stdout: result.stdout, stderr: result.stderr };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

export const readJson = <T>(gcloud: Gcloud, args: string[], flags: Flags = {}): T | null => {
  const result = gcloud.read(args, { ...flags, format: "json" });
  if (!result.ok) return null;
  return JSON.parse(result.stdout) as T;
};
