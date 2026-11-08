import type { CreateRule, NodeOf } from "../types.ts";

// L7: static メンバー・static ブロックと、モジュールのトップレベルの let / var（実質的な static 変数）
// export let は L8（no-public-field）で報告する
export const noStatic: CreateRule = {
  meta: {
    type: "problem",
    messages: {
      staticMember: "L7: static を使わない。インスタンスのメソッド・プロパティにする",
      topLevelLet: "L7: トップレベルに let / var を置かない（実質的な static 変数になる）",
    },
  },
  create(context) {
    const checkMember = (node: NodeOf<"PropertyDefinition" | "MethodDefinition" | "AccessorProperty">) => {
      if (node.static) context.report({ node, messageId: "staticMember" });
    };
    return {
      MethodDefinition: checkMember,
      PropertyDefinition: checkMember,
      AccessorProperty: checkMember,
      StaticBlock(node) {
        context.report({ node, messageId: "staticMember" });
      },
      Program(program) {
        for (const statement of program.body) {
          if (statement.type === "VariableDeclaration" && statement.kind !== "const") {
            context.report({ node: statement, messageId: "topLevelLet" });
          }
        }
      },
    };
  },
};
