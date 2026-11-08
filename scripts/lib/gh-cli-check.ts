import type { CommandRunner } from "./types.ts";

export interface ToolCheck {
  // 使えないときの対処を返す。使えるなら null
  problem(): string | null;
}

// gh を入れたあとに再起動していない VS Code（とその中の Claude Code）は古い PATH のままで、
// gh が "command not found" になる（docs/harness/incidents.md #2）。迷わないよう、対処を示して止める
export class GhCliCheck implements ToolCheck {
  readonly #runner: CommandRunner;

  constructor(runner: CommandRunner) {
    this.#runner = runner;
  }

  problem(): string | null {
    if (this.#runner.run("gh --version").exitCode === 0) return null;
    return [
      "gh（GitHub CLI）が見つからない。",
      "入っていなければ `winget install GitHub.cli` で入れる。",
      "入れてあるなら、VS Code（Claude Code）を起動したあとに PATH が変わっている。VS Code を再起動して PATH を読み直す。",
      "フルパス（C:\\Program Files\\GitHub CLI\\gh.exe）を直接指定してしのがない。",
    ].join("\n");
  }
}
