import type { ParsedSource } from "./source-file.ts";
import type { Finding } from "./types.ts";

export interface LintDisableDetector {
  detect(file: string, source: ParsedSource): Finding[];
}

const DISABLE_PATTERN = /\b(?:oxlint|eslint)-disable|@ts-(?:ignore|expect-error|nocheck)\b/;

// architecture.md §2 の L10・L11。lint や型チェックを止めるコメントを数える
export class CommentLintDisableDetector implements LintDisableDetector {
  detect(file: string, source: ParsedSource): Finding[] {
    return source.comments().flatMap((comment) => {
      const match = DISABLE_PATTERN.exec(comment.value);
      if (match === null) return [];
      return [{ file, line: source.lineOf(comment.start), message: `${match[0]} は使えない` }];
    });
  }
}
