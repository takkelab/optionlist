import type { AstNode, ParsedSource } from "./source-file.ts";
import type { Finding } from "./types.ts";

export interface SwallowedExceptionDetector {
  detect(file: string, source: ParsedSource): Finding[];
}

interface Handler {
  body: AstNode;
  param: string | null;
}

const LOGGER_OBJECTS = new Set(["console", "logger"]);
const FUNCTION_TYPES = new Set(["ArrowFunctionExpression", "FunctionExpression"]);

// metrics.md §2「例外の握り潰し」。次のどれもしない catch / .catch() / .then() の第 2 引数を握り潰しとみなす
// - 再送出（throw）
// - ログ（console.* / logger.*）
// - 応答（res.* / next(...)）
// - 受け取ったエラーを値として使う（setError(e) や return { error: e } など、呼び出し元に渡している）
// ハンドラを名前で渡したもの（.catch(noop)）は中身を確かめられないので握り潰しに数える。next と console.* / logger.* は除く
export class AstSwallowedExceptionDetector implements SwallowedExceptionDetector {
  detect(file: string, source: ParsedSource): Finding[] {
    return source.nodes().flatMap((node) => {
      const handler = this.#handlerOf(node);
      if (handler === null) return [];
      if (handler === "unknown") {
        return [{ file, line: source.lineOf(node.start), message: "例外ハンドラを名前で渡している（中身を確かめられない）" }];
      }
      if (this.#isHandled(source, handler)) return [];
      return [{ file, line: source.lineOf(node.start), message: "例外を握り潰している" }];
    });
  }

  #handlerOf(node: AstNode): Handler | "unknown" | null {
    if (node.type === "CatchClause") {
      return { body: node.body as AstNode, param: this.#identifierName(node.param) };
    }
    const arg = this.#rejectionArgument(node);
    if (arg === undefined) return null;
    if (FUNCTION_TYPES.has(arg.type)) {
      return { body: arg.body as AstNode, param: this.#identifierName((arg.params as AstNode[])[0]) };
    }
    return this.#isReportingCallee(arg) ? null : "unknown";
  }

  // p.catch(handler) の handler と、p.then(ok, handler) の handler
  #rejectionArgument(node: AstNode): AstNode | undefined {
    if (node.type !== "CallExpression") return undefined;
    const callee = node.callee as AstNode;
    if (callee.type !== "MemberExpression") return undefined;
    const method = this.#identifierName(callee.property);
    const args = node.arguments as AstNode[];
    if (method === "catch") return args[0];
    if (method === "then") return args[1];
    return undefined;
  }

  #isHandled(source: ParsedSource, handler: Handler): boolean {
    const nodes = source.within(handler.body);
    const nameOnly = this.#nonReferenceIdentifiers(nodes);
    return nodes.some((node) => {
      if (node.type === "ThrowStatement") return true;
      if (node.type === "Identifier" && node.name === handler.param && !nameOnly.has(node)) return true;
      return node.type === "CallExpression" && this.#isReportingCallee(node.callee as AstNode);
    });
  }

  // 値の参照ではなく名前として書かれている識別子（x.e の e、{ e: 1 } のキー e）
  #nonReferenceIdentifiers(nodes: AstNode[]): Set<unknown> {
    const result = new Set<unknown>();
    for (const node of nodes) {
      if (node.type === "MemberExpression" && node.computed !== true) result.add(node.property);
      if (node.type === "Property" && node.computed !== true && node.shorthand !== true) result.add(node.key);
    }
    return result;
  }

  #isReportingCallee(callee: AstNode): boolean {
    if (callee.type === "Identifier") return callee.name === "next";
    if (callee.type !== "MemberExpression") return false;
    const object = this.#identifierName(callee.object);
    return object !== null && (LOGGER_OBJECTS.has(object) || object === "res");
  }

  #identifierName(node: unknown): string | null {
    const n = node as AstNode | null | undefined;
    return n?.type === "Identifier" ? (n.name as string) : null;
  }
}
