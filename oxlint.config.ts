import { defineConfig } from "oxlint";
import { DESIGN_RULES } from "./tools/lint-rules/design-rules.ts";

// architecture.md §2 のコード設計ルール（L1〜L12）。ルールの一覧は tools/lint-rules/design-rules.ts
// 対象はアプリのコード（backend・frontend・shared・e2e）。scripts/ と tools/ はハーネス側なので対象外（docs/decisions/0005）
// L11（無効化コメント）は lint では止めず、npm run metrics:check が全体を見る
// テストファイルそのものだけ。tests/fakes/ のフェイクや e2e のページオブジェクトは通常のルールで見る
const TEST_FILES = ["**/*.test.ts", "**/*.test.tsx", "e2e/**/*.spec.ts"];
type L5Options = { allowTopLevelStatements?: boolean; allowHooks?: boolean };
// overrides でオプションを渡すと前の指定を置き換えるので、L5 のオプションは組み合わせごとに書く
const l5 = (options: L5Options): ["error", L5Options] => ["error", options];
// 層の向き: そのフォルダから import してはいけない backend/src の層
type Pattern = { group: string[]; message: string };
const layer = (forbidden: string[]): ["error", { patterns: Pattern[] }] => [
  "error",
  {
    patterns: [
      {
        group: [...forbidden.map((dir) => `**/${dir}/**`), "!**/services/errors"],
        message: "architecture.md §3.1: 層の向き（controllers → services → repositories → infra）に逆らう import",
      },
    ],
  },
];
// frontend の層の向き: features / components → app の Context → api・lib。axios は api/ からだけ使う
type FrontendRule = ["error", { paths: { name: string; message: string }[]; patterns: Pattern[] }];
const frontendLayer = (forbidden: string[], withAxios: boolean): FrontendRule => [
  "error",
  {
    paths: withAxios ? [{ name: "axios", message: "architecture.md §3.1: axios は frontend/src/api/ からだけ使う" }] : [],
    patterns: [
      {
        group: forbidden.map((dir) => `**/${dir}/**`),
        message: "architecture.md §3.1: 層の向き（features / components → app の Context → api・lib）に逆らう import",
      },
    ],
  },
];

export default defineConfig({
  plugins: ["typescript", "oxc", "react"],
  jsPlugins: ["./tools/lint-rules/plugin.ts"],
  ignorePatterns: ["oxlint.config.ts", "scripts/**", "tools/**", "**/dist/**", "**/coverage/**", "**/db/migrations/**"],
  rules: DESIGN_RULES,
  overrides: [
    {
      files: ["frontend/**"],
      rules: {
        "react/rules-of-hooks": "error",
        "react/only-export-components": ["warn", { allowConstantExport: true }],
        "design/no-top-level-function": l5({ allowHooks: true }), // L5 の例外: frontend のフック
      },
    },
    // L2 の例外: React コンポーネントは 80 行（.tsx の関数をコンポーネントとみなす）
    {
      files: ["frontend/src/**/*.tsx"],
      rules: { "max-lines-per-function": ["error", { max: 80, skipBlankLines: true, skipComments: true }] },
    },
    // テスト: L1 は 300 行。describe の中身は 40 行を超えるので L2 は見ない。L5 はトップレベルの describe を許す
    {
      files: TEST_FILES,
      rules: {
        "max-lines": ["error", { max: 300, skipBlankLines: true, skipComments: true }],
        "max-lines-per-function": "off",
        "design/no-top-level-function": l5({ allowTopLevelStatements: true }),
      },
    },
    { files: ["frontend/**/*.test.ts", "frontend/**/*.test.tsx"], rules: { "design/no-top-level-function": l5({ allowTopLevelStatements: true, allowHooks: true }) } },
    // L5 の例外: エントリーポイントのトップレベルの文
    { files: ["backend/src/server.ts", "backend/db/perf-data/generate.ts"], rules: { "design/no-top-level-function": l5({ allowTopLevelStatements: true }) } },
    { files: ["frontend/src/main.tsx"], rules: { "design/no-top-level-function": l5({ allowTopLevelStatements: true, allowHooks: true }) } },
    { files: ["shared/**"], rules: { "design/shared-types-only": "error" } }, // L12
    // architecture.md §3.1 の層の向き（backend）。controllers → services → repositories → infra の逆向きと飛び越しを止める
    // services/errors.ts（AppError）はどの層からも読んでよい
    { files: ["backend/src/controllers/**"], rules: { "no-restricted-imports": layer(["repositories", "infra"]) } },
    { files: ["backend/src/services/**"], rules: { "no-restricted-imports": layer(["controllers", "infra"]) } },
    { files: ["backend/src/repositories/**"], rules: { "no-restricted-imports": layer(["controllers", "services"]) } },
    { files: ["backend/src/infra/**"], rules: { "no-restricted-imports": layer(["controllers", "services", "repositories"]) } },
    {
      files: ["backend/src/middleware/**", "backend/src/metrics/**"],
      rules: { "no-restricted-imports": layer(["controllers", "services", "repositories", "infra"]) },
    },
    // architecture.md §3.1 の層の向き（frontend）。画面は API を Context 経由で使い、api・lib は画面を知らない
    {
      files: ["frontend/src/features/**", "frontend/src/components/**"],
      rules: { "no-restricted-imports": frontendLayer(["api"], true) },
    },
    {
      files: ["frontend/src/api/**", "frontend/src/lib/**"],
      rules: { "no-restricted-imports": frontendLayer(["app", "features", "components"], false) },
    },
  ],
});
