import type { CreateRule, Expression } from "../types.ts";

// L10: as unknown as / <unknown> による型の付け替え
export const noDoubleCast: CreateRule = {
  meta: { type: "problem", messages: { doubleCast: "L10: as unknown as で型を付け替えない" } },
  create(context) {
    const isUnknownCast = (node: Expression) =>
      (node.type === "TSAsExpression" || node.type === "TSTypeAssertion") &&
      node.typeAnnotation.type === "TSUnknownKeyword";
    return {
      TSAsExpression(node) {
        if (isUnknownCast(node.expression)) context.report({ node, messageId: "doubleCast" });
      },
      TSTypeAssertion(node) {
        if (isUnknownCast(node.expression)) context.report({ node, messageId: "doubleCast" });
      },
    };
  },
};
