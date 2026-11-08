import type { OxlintConfig } from "oxlint";

// architecture.md §2 のルールに当たる oxlint のルール。oxlint.config.ts と、違反を数える scripts/lib/command-collector.ts が読む
// L5 の例外・L12 の shared-types-only など、ファイルによって設定を変えるものは oxlint.config.ts の overrides に書く
export const DESIGN_RULES = {
  "max-lines": ["error", { max: 200, skipBlankLines: true, skipComments: true }], // L1
  "max-lines-per-function": ["error", { max: 40, skipBlankLines: true, skipComments: true }], // L2
  "design/no-wide-mock": "error", // L3
  "design/law-of-demeter": "error", // L4
  "design/no-top-level-function": "error", // L5
  "design/class-implements-interface": "error", // L6
  "design/no-static": "error", // L7
  "design/no-public-field": "error", // L8
  "design/no-extends": "error", // L9
  "typescript/no-explicit-any": "error", // L10
  "typescript/ban-ts-comment": ["error", { "ts-ignore": true, "ts-expect-error": true, "ts-nocheck": true }], // L10
  "design/no-double-cast": "error", // L10
  "design/import-shared-as-type": "error", // L12
  "design/shared-types-only": "off", // L12（shared/** だけで有効にする）
  "design/user-scoped-db": "off", // L13（backend/src/** だけで有効にする）
  "no-restricted-imports": "off", // §3.1 の層の向き（backend/src の層ごとに oxlint.config.ts の overrides で有効にする）
} satisfies NonNullable<OxlintConfig["rules"]>;
