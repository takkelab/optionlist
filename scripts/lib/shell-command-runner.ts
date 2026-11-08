import { spawnSync } from "node:child_process";
import type { CommandResult, CommandRunner } from "./types.ts";

// npm は Windows では npm.cmd なので shell 経由で実行する
export class ShellCommandRunner implements CommandRunner {
  readonly #cwd: string;

  constructor(cwd: string) {
    this.#cwd = cwd;
  }

  run(command: string, env: Record<string, string> = {}): CommandResult {
    const started = performance.now();
    const result = spawnSync(command, {
      cwd: this.#cwd,
      shell: true,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, ...env },
    });
    const durationSec = Math.round((performance.now() - started) / 100) / 10;
    if (result.error !== undefined) throw result.error;
    return { exitCode: result.status ?? 1, output: `${result.stdout}${result.stderr}`, durationSec };
  }
}
