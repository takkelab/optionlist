import type { CreateRule, NodeOf } from "../types.ts";

// L9: 継承は許可リストにあるクラスだけ。L6（class-implements-interface）も同じリストを使う
export const ALLOWED_BASE_CLASSES = ["Error"];

export const isAllowedBase = (node: NodeOf<"ClassDeclaration">) =>
  node.superClass?.type === "Identifier" && ALLOWED_BASE_CLASSES.includes(node.superClass.name);

export const noExtends: CreateRule = {
  meta: {
    type: "problem",
    messages: { extends: `L9: 継承しない（許可リスト: ${ALLOWED_BASE_CLASSES.join(", ")}）。インタフェースと委譲を使う` },
  },
  create(context) {
    const check = (node: NodeOf<"ClassDeclaration">) => {
      if (node.superClass !== null && !isAllowedBase(node)) context.report({ node, messageId: "extends" });
    };
    return { ClassDeclaration: check, ClassExpression: check };
  },
};
