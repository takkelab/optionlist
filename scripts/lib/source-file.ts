import { parseSync } from "oxc-parser";
import type { Comment } from "oxc-parser";

export interface AstNode {
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
}

export interface ParsedSource {
  nodes(): AstNode[];
  // node 自身を含む、node の範囲内のノード
  within(node: AstNode): AstNode[];
  comments(): Comment[];
  // 構文エラー。あると AST が途中までしかなく、検査が見逃すので失敗にする
  errors(): string[];
  lineOf(offset: number): number;
}

// oxc-parser の結果を、全ノードを平たく並べた形で扱えるようにする
export class OxcParsedSource implements ParsedSource {
  readonly #text: string;
  readonly #nodes: AstNode[] = [];
  readonly #comments: Comment[];
  readonly #errors: string[];

  constructor(filename: string, text: string) {
    this.#text = text;
    const result = parseSync(filename, text);
    this.#comments = result.comments;
    this.#errors = result.errors.map((error) => error.message);
    this.#collect(result.program);
  }

  nodes(): AstNode[] {
    return this.#nodes;
  }

  within(node: AstNode): AstNode[] {
    return this.#nodes.filter((n) => n.start >= node.start && n.end <= node.end);
  }

  comments(): Comment[] {
    return this.#comments;
  }

  errors(): string[] {
    return this.#errors;
  }

  lineOf(offset: number): number {
    return this.#text.slice(0, offset).split("\n").length;
  }

  #collect(value: unknown): void {
    if (Array.isArray(value)) {
      value.forEach((item) => this.#collect(item));
      return;
    }
    if (!this.#isNode(value)) return;
    this.#nodes.push(value);
    Object.values(value).forEach((child) => this.#collect(child));
  }

  #isNode(value: unknown): value is AstNode {
    return typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string";
  }
}
