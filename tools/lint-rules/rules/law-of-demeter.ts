import type { CreateRule, Expression, NodeOf } from "../types.ts";

// L4: 「先の先」をたどらない。根元から数えたメンバーアクセスの段数が 2 以上なら違反（a.b.c、a.b.c()、a.b().c）
// - this と自分のフィールド（this.x、this.#x）は 0 段目。this.repo.find() はよい
// - 呼び出しの戻り値に続く許可リストのメンバーは段数を増やさない（型情報は使わず名前で判定する）
// - process.env.X、import.meta.env.X、名前空間 import（import * as ns）の ns.x は数えない
export const CHAINABLE_MEMBERS = new Set([
  // 配列
  "map",
  "filter",
  "reduce",
  "forEach",
  "find",
  "findIndex",
  "findLast",
  "some",
  "every",
  "includes",
  "indexOf",
  "join",
  "slice",
  "concat",
  "flat",
  "flatMap",
  "sort",
  "toSorted",
  "toReversed",
  "at",
  "keys",
  "values",
  "entries",
  "length",
  // 文字列
  "trim",
  "split",
  "replace",
  "replaceAll",
  "toLowerCase",
  "toUpperCase",
  "startsWith",
  "endsWith",
  "padStart",
  "padEnd",
  "match",
  "toString",
  "toFixed",
  // Promise
  "then",
  "catch",
  "finally",
  // Express の res.status().json()
  "json",
  "send",
  "end",
]);
// Vitest の expect(x).not.toBe() など。段数を増やさない
const PASS_THROUGH_MEMBERS = new Set(["not", "resolves", "rejects"]);
const WRAPPERS = new Set([
  "ChainExpression",
  "TSNonNullExpression",
  "TSAsExpression",
  "TSSatisfiesExpression",
  "TSTypeAssertion",
]);

type Member = NodeOf<"MemberExpression">;

export const lawOfDemeter: CreateRule = {
  meta: {
    type: "problem",
    messages: { chain: "L4: 2 段以上たどらない（{{text}}）。相手にメソッドを足して頼む" },
  },
  create(context) {
    const namespaces = new Set<string>();
    const unwrap = (node: Expression): Expression => {
      if ((WRAPPERS.has(node.type) || node.type === "ParenthesizedExpression") && "expression" in node) {
        return unwrap(node.expression as Expression);
      }
      return node;
    };
    const memberName = (node: Member) => (node.computed ? undefined : node.property.name);
    const isEnv = (node: Member) => {
      const object = unwrap(node.object);
      const isProcess = object.type === "Identifier" && object.name === "process";
      return memberName(node) === "env" && (isProcess || object.type === "MetaProperty");
    };
    const depth = (expression: Expression): number => {
      const node = unwrap(expression);
      if (node.type === "CallExpression") return depth(node.callee);
      // (await a.b()).c は a.b().c と同じに数える
      if (node.type === "AwaitExpression") return depth(node.argument);
      if (node.type !== "MemberExpression") return 0;
      const object = unwrap(node.object);
      const name = memberName(node) ?? "";
      if (isEnv(node) || object.type === "ThisExpression") return 0;
      if (object.type === "Identifier" && namespaces.has(object.name)) return 0;
      if (PASS_THROUGH_MEMBERS.has(name)) return depth(object);
      const isResult = object.type === "CallExpression" || object.type === "AwaitExpression";
      if (isResult && CHAINABLE_MEMBERS.has(name)) return depth(object);
      return depth(object) + 1;
    };
    return {
      ImportNamespaceSpecifier(node) {
        namespaces.add(node.local.name);
      },
      MemberExpression(node) {
        if (depth(node) >= 2 && depth(node.object) < 2) {
          context.report({ node, messageId: "chain", data: { text: context.sourceCode.getText(node) } });
        }
      },
    };
  },
};
