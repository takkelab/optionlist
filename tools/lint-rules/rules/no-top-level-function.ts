import type { CreateRule, Expression, NodeOf, Statement } from "../types.ts";
import { CHAINABLE_MEMBERS } from "./law-of-demeter.ts";

// L5: トップレベルの関数（function 宣言、変数に入れたアロー関数・関数式）と、宣言以外のトップレベルの文を禁止する
// 変数の初期値の中（オブジェクトの値・配列の要素・呼び出しの引数）に入れた関数も、トップレベルの関数として数える
// （asyncHandler(…)、Router().get("/", …)、Object.freeze({ … }) など）。ただし items.map((x) => …) のように
// 配列・Promise などのメソッド（law-of-demeter.ts の CHAINABLE_MEMBERS）に渡すものは値の計算なので数えない
// 例外: .tsx の大文字で始まるもの（React コンポーネント。memo(() => …) も含む）
// 設定で渡す例外: allowHooks（frontend の useXxx）、allowTopLevelStatements（エントリーポイントとテストのトップレベルの文）
const DECLARATION_TYPES = new Set([
  "ImportDeclaration",
  "ExportAllDeclaration",
  "ExportNamedDeclaration",
  "ExportDefaultDeclaration",
  "VariableDeclaration",
  "FunctionDeclaration",
  "TSDeclareFunction",
  "ClassDeclaration",
  "TSTypeAliasDeclaration",
  "TSInterfaceDeclaration",
  "TSEnumDeclaration",
  "TSModuleDeclaration",
  "TSGlobalDeclaration",
  "TSImportEqualsDeclaration",
  "TSExportAssignment",
  "TSNamespaceExportDeclaration",
  "EmptyStatement",
]);
const WRAPPERS = new Set(["TSAsExpression", "TSSatisfiesExpression", "TSNonNullExpression", "ParenthesizedExpression"]);

type Declared = Statement | NodeOf<"ExportDefaultDeclaration">["declaration"];
type Options = { allowTopLevelStatements?: boolean; allowHooks?: boolean };

export const noTopLevelFunction: CreateRule = {
  meta: {
    type: "problem",
    messages: {
      topLevelFunction: "L5: トップレベルに関数を書かない。処理はクラスのメソッドに書く",
      topLevelStatement: "L5: トップレベルで処理を実行しない（エントリーポイントとテストだけ許可）",
    },
    schema: [
      {
        type: "object",
        properties: { allowTopLevelStatements: { type: "boolean" }, allowHooks: { type: "boolean" } },
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const options = (context.options[0] ?? {}) as Options;
    const isTsx = context.filename.endsWith(".tsx");
    const isAllowedName = (name: string | undefined) =>
      name !== undefined && ((options.allowHooks === true && /^use[A-Z0-9]/.test(name)) || (isTsx && /^[A-Z]/.test(name)));
    // 値の位置（ラッパー・オブジェクト・配列・呼び出しの引数・条件式）に関数があるか。関数の中までは見ない
    const containsFunction = (node: Expression | null | undefined): boolean => {
      if (node === null || node === undefined) return false;
      if (node.type === "ArrowFunctionExpression" || node.type === "FunctionExpression") return true;
      if (WRAPPERS.has(node.type) && "expression" in node) return containsFunction(node.expression as Expression);
      if (node.type === "ObjectExpression") {
        return node.properties.some((p) => containsFunction(p.type === "SpreadElement" ? p.argument : (p.value as Expression)));
      }
      if (node.type === "ArrayExpression") {
        return node.elements.some((e) => e !== null && containsFunction(e.type === "SpreadElement" ? e.argument : e));
      }
      const callee = node.type === "CallExpression" ? node.callee : undefined;
      if (callee?.type === "MemberExpression" && !callee.computed && CHAINABLE_MEMBERS.has(callee.property.name)) {
        return containsFunction(callee.object);
      }
      if (node.type === "CallExpression" || node.type === "NewExpression") {
        if (node.type === "CallExpression" && containsFunction(node.callee)) return true;
        return node.arguments.some((a) => containsFunction(a.type === "SpreadElement" ? a.argument : a));
      }
      // Router().post("/", fn).get(…) のように、チェーンの手前の呼び出しもたどる
      if (node.type === "MemberExpression") return containsFunction(node.object);
      if (node.type === "ConditionalExpression") return containsFunction(node.consequent) || containsFunction(node.alternate);
      if (node.type === "LogicalExpression") return containsFunction(node.left) || containsFunction(node.right);
      return false;
    };
    const reportFunction = (node: Declared) => context.report({ node, messageId: "topLevelFunction" });
    const checkDeclared = (node: Declared | null) => {
      if (node === null) return;
      if (node.type === "FunctionDeclaration") {
        if (!isAllowedName(node.id?.name)) reportFunction(node);
      } else if (node.type === "VariableDeclaration") {
        for (const declarator of node.declarations) {
          const name = declarator.id.type === "Identifier" ? declarator.id.name : undefined;
          if (containsFunction(declarator.init) && !isAllowedName(name)) reportFunction(node);
        }
      } else if (node.type !== "ClassDeclaration" && node.type !== "TSDeclareFunction" && "type" in node) {
        if (containsFunction(node as Expression)) reportFunction(node);
      }
    };
    const isDirective = (node: Statement) =>
      node.type === "ExpressionStatement" && "directive" in node && typeof node.directive === "string";
    return {
      Program(program) {
        for (const statement of program.body) {
          if (statement.type === "ExportNamedDeclaration" || statement.type === "ExportDefaultDeclaration") {
            checkDeclared(statement.declaration);
          } else if (statement.type === "VariableDeclaration" || statement.type === "FunctionDeclaration") {
            checkDeclared(statement);
          }
          if (!options.allowTopLevelStatements && !DECLARATION_TYPES.has(statement.type) && !isDirective(statement)) {
            context.report({ node: statement, messageId: "topLevelStatement" });
          }
        }
      },
    };
  },
};
