import type { CreateRule, NodeOf } from "../types.ts";

// L8: クラスのプロパティは private か #。コンストラクタ引数プロパティも同じ。export let も禁止
// static のプロパティは L7（no-static）で報告する
export const noPublicField: CreateRule = {
  meta: {
    type: "problem",
    messages: {
      publicField: "L8: プロパティは private か # にする。外から読むならメソッドで返す",
      exportLet: "L8: export let で変数を公開しない",
    },
  },
  create(context) {
    const checkProperty = (node: NodeOf<"PropertyDefinition" | "AccessorProperty">) => {
      if (node.static || node.key.type === "PrivateIdentifier" || node.accessibility === "private") return;
      context.report({ node, messageId: "publicField" });
    };
    return {
      PropertyDefinition: checkProperty,
      AccessorProperty: checkProperty,
      TSParameterProperty(node) {
        if (node.accessibility !== "private") context.report({ node, messageId: "publicField" });
      },
      ExportNamedDeclaration(node) {
        const declaration = node.declaration;
        if (declaration?.type === "VariableDeclaration" && declaration.kind !== "const") {
          context.report({ node, messageId: "exportLet" });
        }
      },
    };
  },
};
