import type { CreateRule, Statement } from "../types.ts";

// L12: shared/ には type / interface だけを書く（設定で shared/** にだけ有効にする）
const TYPE_DECLARATIONS = new Set(["TSTypeAliasDeclaration", "TSInterfaceDeclaration"]);

export const sharedTypesOnly: CreateRule = {
  meta: { type: "problem", messages: { runtime: "L12: shared/ には type と interface だけを書く" } },
  create(context) {
    const isTypeOnly = (node: Statement): boolean => {
      if (TYPE_DECLARATIONS.has(node.type)) return true;
      if (node.type === "ImportDeclaration") {
        // import { type X } は実行時に import が残るので許さない（import-shared-as-type と同じ）
        return node.importKind === "type";
      }
      if (node.type === "ExportNamedDeclaration") {
        if (node.declaration !== null) return TYPE_DECLARATIONS.has(node.declaration.type);
        return node.exportKind === "type";
      }
      return node.type === "ExportAllDeclaration" && node.exportKind === "type";
    };
    return {
      Program(program) {
        for (const statement of program.body) {
          if (!isTypeOnly(statement)) context.report({ node: statement, messageId: "runtime" });
        }
      },
    };
  },
};
