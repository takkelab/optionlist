import type { CreateRule, NodeOf } from "../types.ts";
import { isAllowedBase } from "./no-extends.ts";

// L6: クラスは implements でインタフェースを 1 つ以上実装する。Error を継承したエラークラスは例外
export const classImplementsInterface: CreateRule = {
  meta: { type: "problem", messages: { noInterface: "L6: クラスは implements でインタフェースを実装する" } },
  create(context) {
    const check = (node: NodeOf<"ClassDeclaration">) => {
      if ((node.implements ?? []).length === 0 && !isAllowedBase(node)) {
        context.report({ node, messageId: "noInterface" });
      }
    };
    return { ClassDeclaration: check, ClassExpression: check };
  },
};
