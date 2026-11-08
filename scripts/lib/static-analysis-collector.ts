import type { DesignTokenChecker } from "./design-token-checker.ts";
import type { LintDisableDetector } from "./lint-disable-detector.ts";
import type { LintRuleTestChecker } from "./lint-rule-test-checker.ts";
import { OxcParsedSource } from "./source-file.ts";
import type { SwallowedExceptionDetector } from "./swallowed-exception-detector.ts";
import type { CheckResult, FileSource, Finding, Measurement } from "./types.ts";

export interface CollectedMetrics {
  checks: CheckResult[];
  measurements: Measurement[];
  findings: Finding[];
}

export interface MetricCollector {
  collect(): CollectedMetrics;
}

export interface StaticAnalysisDetectors {
  swallowed: SwallowedExceptionDetector;
  lintDisable: LintDisableDetector;
  tokens: DesignTokenChecker;
  ruleTests: LintRuleTestChecker;
}

const SCRIPT_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
// 例外の握り潰しと lint 無効化コメントを探す場所。テスト・設定ファイル・db/ の生成スクリプトも含める
// （node_modules・dist・coverage は NodeFileSource が除く）
const CODE_DIRS = ["backend", "frontend", "scripts", "tools", "shared", "e2e"];
const FRONTEND_DIR = "frontend/src";
const TOKENS_CSS = "frontend/src/styles/tokens.css";

// ファイルを読むだけで測れる指標（metrics.md §2 の握り潰し・無効化コメント・自作 lint ルールのテスト、§3 のトークン）
export class StaticAnalysisCollector implements MetricCollector {
  readonly #files: FileSource;
  readonly #swallowed: SwallowedExceptionDetector;
  readonly #lintDisable: LintDisableDetector;
  readonly #tokens: DesignTokenChecker;
  readonly #ruleTests: LintRuleTestChecker;

  constructor(files: FileSource, detectors: StaticAnalysisDetectors) {
    this.#files = files;
    this.#swallowed = detectors.swallowed;
    this.#lintDisable = detectors.lintDisable;
    this.#tokens = detectors.tokens;
    this.#ruleTests = detectors.ruleTests;
  }

  collect(): CollectedMetrics {
    const swallowed: Finding[] = [];
    const lintDisable: Finding[] = [];
    const parseErrors: Finding[] = [];
    for (const file of this.#files.list(CODE_DIRS, SCRIPT_EXTENSIONS)) {
      const source = new OxcParsedSource(file, this.#files.read(file));
      parseErrors.push(...source.errors().map((message) => ({ file, line: 0, message: `構文エラー: ${message}` })));
      swallowed.push(...this.#swallowed.detect(file, source));
      lintDisable.push(...this.#lintDisable.detect(file, source));
    }
    const colors = this.#hardcodedColors();
    const decoMisuse = this.#decoMisuse();
    const ruleTests = this.#ruleTests.check(this.#files);
    return {
      checks: [{ name: "ソースの構文解析", ok: parseErrors.length === 0, durationSec: 0 }],
      measurements: [
        { id: "swallowed-exceptions", kind: "value", value: swallowed.length },
        { id: "lint-disable-comments", kind: "value", value: lintDisable.length },
        { id: "hardcoded-colors", kind: "value", value: colors.length },
        { id: "deco-color-misuse", kind: "value", value: decoMisuse.length },
        ruleTests.measurement,
        ...this.#tokenCounts(),
      ],
      findings: [...parseErrors, ...swallowed, ...lintDisable, ...colors, ...decoMisuse, ...ruleTests.findings],
    };
  }

  // 装飾の色を縁以外に使っている箇所（docs/decisions/0024）。tokens.css の別名も追うので tokens.css も渡す
  #decoMisuse(): Finding[] {
    const tokens = this.#tokens;
    const css = this.#files.list([FRONTEND_DIR], [".css"]);
    const scripts = this.#files.list([FRONTEND_DIR], SCRIPT_EXTENSIONS);
    return [
      ...tokens.findDecoMisuse(css.map((file) => ({ file, css: this.#files.read(file) }))),
      ...scripts.flatMap((file) => tokens.findDecoInScript(file, new OxcParsedSource(file, this.#files.read(file)))),
    ];
  }

  #hardcodedColors(): Finding[] {
    const tokens = this.#tokens;
    const css = this.#files.list([FRONTEND_DIR], [".css"]).filter((file) => file !== TOKENS_CSS);
    const scripts = this.#files.list([FRONTEND_DIR], SCRIPT_EXTENSIONS);
    return [
      ...css.flatMap((file) => tokens.findHardcodedColorsInCss(file, this.#files.read(file))),
      ...scripts.flatMap((file) =>
        tokens.findHardcodedColorsInScript(file, new OxcParsedSource(file, this.#files.read(file))),
      ),
    ];
  }

  #tokenCounts(): Measurement[] {
    const ids = ["color-tokens", "deco-color-tokens", "font-size-tokens", "spacing-tokens"];
    if (!this.#files.exists(TOKENS_CSS)) {
      return ids.map((id) => ({ id, kind: "notApplicable", detail: `${TOKENS_CSS} がまだない` }));
    }
    const counts = this.#tokens.countTokens(this.#files.read(TOKENS_CSS));
    return [
      { id: "color-tokens", kind: "value", value: counts.colors },
      { id: "deco-color-tokens", kind: "value", value: counts.decoColors },
      { id: "font-size-tokens", kind: "value", value: counts.fontSizes },
      { id: "spacing-tokens", kind: "value", value: counts.spacings },
    ];
  }
}
