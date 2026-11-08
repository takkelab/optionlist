import type { ParsedSource } from "./source-file.ts";
import type { Finding } from "./types.ts";

export interface TokenCounts {
  colors: number;
  decoColors: number;
  fontSizes: number;
  spacings: number;
}

export type StyleSheet = { file: string; css: string };

export interface DesignTokenChecker {
  countTokens(tokensCss: string): TokenCounts;
  findHardcodedColorsInCss(file: string, css: string): Finding[];
  findHardcodedColorsInScript(file: string, source: ParsedSource): Finding[];
  // 装飾の色（--deco-*）を縁以外に使っている宣言。--deco-* を値に持つ変数（--theme-color など）を通した使い方も含める
  // sheets には tokens.css も入れる（tokens.css で作った別名も追う）
  findDecoMisuse(sheets: StyleSheet[]): Finding[];
  // TS/TSX の文字列で装飾の色を使っている箇所（インラインの style で縁以外に塗るのを防ぐ）
  findDecoInScript(file: string, source: ParsedSource): Finding[];
}

// 色の書き方: #rgb / #rgba / #rrggbb / #rrggbbaa、rgb() / rgba() / hsl() / hsla()
const COLOR_PATTERN = /(?<![\w&-])#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b|\b(?:rgba?|hsla?)\s*\([^)]*\)?/gi;
// 「:」から「;」か「}」までを宣言の値とみなす（セレクタの :hover などは「{」が続くので対象外）
const DECLARATION_VALUE = /:([^;{}]+)(?=[;}])/g;
const CUSTOM_PROPERTY = /(--[\w-]+)\s*:([^;{}]+)(?=[;}])/g;
const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
// 宣言（プロパティ名と値）。セレクタの :hover などは「{」が続くので対象外
const DECLARATION = /([\w-]+)\s*:([^;{}]+)(?=[;}])/g;
const DECO_PREFIX = "--deco-";
// 装飾の色を使ってよいプロパティ（縁）
const EDGE_PROPERTY = /^(?:border(?:-(?:top|right|bottom|left))?(?:-color)?|outline(?:-color)?|box-shadow)$/;
// 虹の縁は、背景を padding-box と border-box に重ねて描く。border-box に重ねる background だけは縁とみなす
const BORDER_BOX_BACKGROUND = /^background(?:-image)?$/;
// 縁の唯一の例外: 追加ボタンを押したときにはじける粒の background（docs/decisions/0027）
const BURST_SHEET = /\/AddButton\.module\.css$/;

// metrics.md §3（docs/decisions/0003、0024）
// - 色: tokens.css に書かれた色の値の種類（名前に関係なく数える。ダークモードで同じ値を使い回せば 1 色）。--deco-* は除く
// - 装飾の色: --deco-* に書かれた色の値の種類
// - 文字サイズ・余白: --font-size-* / --space-* に入っている値の種類
export class CssDesignTokenChecker implements DesignTokenChecker {
  countTokens(tokensCss: string): TokenCounts {
    const css = tokensCss.replace(BLOCK_COMMENT, "");
    const declarations = [...css.matchAll(CUSTOM_PROPERTY)].map((m) => ({ name: m[1], value: m[2] }));
    const distinctValues = (prefix: string) =>
      new Set(declarations.filter((d) => d.name.startsWith(prefix)).map((d) => this.#normalize(d.value))).size;
    const decoValues = declarations.filter((d) => d.name.startsWith(DECO_PREFIX)).map((d) => d.value);
    const decoColors = this.#distinctColors(decoValues.join(";"));
    const withoutDeco = css.replace(CUSTOM_PROPERTY, (whole, name: string) => (name.startsWith(DECO_PREFIX) ? "" : whole));
    return {
      colors: this.#distinctColors(withoutDeco),
      decoColors,
      fontSizes: distinctValues("--font-size-"),
      spacings: distinctValues("--space-"),
    };
  }

  findDecoMisuse(sheets: StyleSheet[]): Finding[] {
    const parsed = sheets.map(({ file, css }) => ({ file, text: this.#blankComments(css) }));
    const decoNames = this.#decoNames(parsed.map(({ text }) => text));
    return parsed.flatMap(({ file, text }) =>
      [...text.matchAll(DECLARATION)].flatMap((m) => {
        const [, name, value] = m;
        if (name.startsWith("--") || !this.#refersTo(value, decoNames) || this.#isEdge(name, value, decoNames)) return [];
        if (name === "background" && BURST_SHEET.test(file)) return [];
        const line = text.slice(0, m.index ?? 0).split("\n").length;
        return [{ file, line, message: `装飾の色を ${name} に使っている（縁: border・box-shadow・outline にだけ使う）` }];
      }),
    );
  }

  findDecoInScript(file: string, source: ParsedSource): Finding[] {
    return source.nodes().flatMap((node) => {
      const text = this.#stringValue(node);
      if (text === null || !/--deco-|--theme-color/.test(text)) return [];
      return [{ file, line: source.lineOf(node.start), message: "装飾の色は TS/TSX から使わない（CSS の縁で使う）" }];
    });
  }

  // --deco-* を値に持つ変数（tokens.css の別名や ThemeColor.module.css の --theme-color など）も装飾の色として扱う
  // 別名の別名もあり、ファイルの順番に左右されないよう、増えなくなるまで集める
  #decoNames(texts: string[]): Set<string> {
    const custom = texts.flatMap((text) =>
      [...text.matchAll(DECLARATION)].filter(([, name]) => name.startsWith("--")).map(([, name, value]) => ({ name, value })),
    );
    const names = new Set<string>();
    let grew = true;
    while (grew) {
      grew = false;
      for (const { name, value } of custom) {
        if (!names.has(name) && (name.startsWith(DECO_PREFIX) || this.#refersTo(value, names))) {
          names.add(name);
          grew = true;
        }
      }
    }
    return names;
  }

  #refersTo(value: string, decoNames: Set<string>): boolean {
    return [...value.matchAll(/var\(\s*(--[\w-]+)/g)].some(([, ref]) => ref.startsWith(DECO_PREFIX) || decoNames.has(ref));
  }

  // 縁: border・box-shadow・outline。background は虹の縁の形（装飾の色の層が border-box にあり、その上を装飾の色でない padding-box の層が覆う）だけ
  #isEdge(property: string, value: string, decoNames: Set<string>): boolean {
    if (EDGE_PROPERTY.test(property)) return true;
    if (!BORDER_BOX_BACKGROUND.test(property)) return false;
    const layers = this.#layers(value);
    return layers.every((layer, i) => {
      if (!this.#refersTo(layer, decoNames)) return true;
      const covered = layers.slice(0, i).some((above) => /\bpadding-box\b/.test(above) && !this.#refersTo(above, decoNames));
      return /\bborder-box\b/.test(layer) && !/\bpadding-box\b/.test(layer) && covered;
    });
  }

  // background の層（括弧の外のカンマで区切る。先に書いた層が上）
  #layers(value: string): string[] {
    const layers: string[] = [];
    let depth = 0;
    let current = "";
    for (const ch of value) {
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      if (ch === "," && depth === 0) {
        layers.push(current);
        current = "";
      } else current += ch;
    }
    return [...layers, current];
  }

  #blankComments(css: string): string {
    return css.replace(BLOCK_COMMENT, (comment) => comment.replace(/[^\n]/g, " "));
  }

  #distinctColors(css: string): number {
    return new Set(this.#colorsIn(css).map((color) => this.#normalize(color))).size;
  }

  #normalize(value: string): string {
    return value.replace(/\s+/g, "").toLowerCase();
  }

  findHardcodedColorsInCss(file: string, css: string): Finding[] {
    const text = css.replace(BLOCK_COMMENT, (comment) => comment.replace(/[^\n]/g, " "));
    return [...text.matchAll(DECLARATION_VALUE)].flatMap((declaration) => {
      const offset = (declaration.index ?? 0) + 1;
      return this.#colorsIn(declaration[1]).map((color) => ({
        file,
        line: text.slice(0, offset).split("\n").length,
        message: `色の直書き ${color}（tokens.css の変数を使う）`,
      }));
    });
  }

  // TS/TSX は文字列とテンプレートの中だけを見る（#private フィールドを色と誤認しないため）
  findHardcodedColorsInScript(file: string, source: ParsedSource): Finding[] {
    return source.nodes().flatMap((node) => {
      const text = this.#stringValue(node);
      if (text === null) return [];
      return this.#colorsIn(text).map((color) => ({
        file,
        line: source.lineOf(node.start),
        message: `色の直書き ${color}（tokens.css の変数を使う）`,
      }));
    });
  }

  #stringValue(node: { type: string; [key: string]: unknown }): string | null {
    if (node.type === "Literal" && typeof node.value === "string") return node.value;
    if (node.type === "TemplateElement") return (node.value as { raw: string }).raw;
    return null;
  }

  #colorsIn(text: string): string[] {
    return [...text.matchAll(COLOR_PATTERN)].map((m) => m[0]);
  }
}
