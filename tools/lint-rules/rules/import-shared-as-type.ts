import type { CreateRule, NodeOf } from "../types.ts";

// L12: shared/ からは import type で読む（shared/ の実行コードに依存させない）
// import { type X } は verbatimModuleSyntax だと実行時に import "…/shared/…" が残るので許さない
const SHARED_PATH = /(^|\/)shared(\/|$)/;

type FromShared = NodeOf<"ImportDeclaration" | "ExportNamedDeclaration" | "ExportAllDeclaration">;

export const importSharedAsType: CreateRule = {
  meta: { type: "problem", messages: { valueImport: "L12: shared/ からは import type / export type で読む" } },
  create(context) {
    const fromShared = (node: FromShared) => node.source !== null && SHARED_PATH.test(node.source.value);
    return {
      ImportDeclaration(node) {
        if (fromShared(node) && node.importKind !== "type") context.report({ node, messageId: "valueImport" });
      },
      ExportNamedDeclaration(node) {
        if (fromShared(node) && node.exportKind !== "type") context.report({ node, messageId: "valueImport" });
      },
      ExportAllDeclaration(node) {
        if (fromShared(node) && node.exportKind !== "type") context.report({ node, messageId: "valueImport" });
      },
    };
  },
};
