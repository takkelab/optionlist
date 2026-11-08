import type { Context, CreateRule, Expression, NodeOf } from "../types.ts";

// L3: 影響範囲の広いモック。vi.mock / vi.doMock / vi.stubGlobal、import した名前やグローバル（組み込みオブジェクト）への
// vi.spyOn、E2E の page.route などを禁止する。依存はコンストラクタで受け取り、テストではフェイクを渡す
const BANNED_VI_METHODS = new Set(["mock", "doMock", "stubGlobal"]);
const ROUTE_METHODS = new Set(["route", "routeFromHAR", "routeWebSocket"]);
const PLAYWRIGHT_OBJECT = /^(page|context)$|Page$|Context$/;

type Identifier = NodeOf<"Identifier">;
type Scope = ReturnType<Context["sourceCode"]["getScope"]>;

export const noWideMock: CreateRule = {
  meta: {
    type: "problem",
    messages: {
      viMock: "L3: vi.{{name}} を使わない。依存をコンストラクタで受け取り、フェイクを渡す",
      spyOnModule: "L3: import したモジュールや組み込みオブジェクトに vi.spyOn しない。フェイクを渡す",
      pageRoute: "L3: E2E で {{name}} による差し替えをしない。テスト用 DB に向けた backend を使う",
    },
  },
  create(context) {
    const imported = new Set<string>();
    // spyOn の対象の根元の名前（URL、HTMLCanvasElement.prototype なら URL・HTMLCanvasElement）
    const rootIdentifier = (node: Expression): Identifier | undefined => {
      if (node.type === "Identifier") return node;
      if (node.type === "MemberExpression") return rootIdentifier(node.object);
      return undefined;
    };
    const lastName = (node: Expression): string | undefined => {
      if (node.type === "Identifier") return node.name;
      if (node.type === "MemberExpression" && !node.computed) return node.property.name;
      return undefined;
    };
    // import した名前と、ファイル内で宣言していない名前（組み込みオブジェクトや DOM）。
    // isGlobalReference は設定済みのグローバルしか拾わないので、スコープを上にたどって宣言を探す
    const isDeclaredInFile = (id: Identifier) => {
      for (let scope: Scope | null = context.sourceCode.getScope(id); scope !== null; scope = scope.upper) {
        const variable = scope.set.get(id.name);
        if (variable !== undefined && variable.defs.length > 0) return true;
      }
      return false;
    };
    const isModuleOrGlobal = (id: Identifier) => imported.has(id.name) || !isDeclaredInFile(id);
    return {
      ImportDeclaration(node) {
        for (const specifier of node.specifiers) imported.add(specifier.local.name);
      },
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== "MemberExpression" || callee.computed || callee.property.type !== "Identifier") return;
        const method = callee.property.name;
        const target = node.arguments[0];
        if (callee.object.type === "Identifier" && callee.object.name === "vi") {
          if (BANNED_VI_METHODS.has(method)) context.report({ node, messageId: "viMock", data: { name: method } });
          const root = target !== undefined && target.type !== "SpreadElement" ? rootIdentifier(target) : undefined;
          if (method === "spyOn" && root !== undefined && isModuleOrGlobal(root)) {
            context.report({ node, messageId: "spyOnModule" });
          }
        } else if (ROUTE_METHODS.has(method) && PLAYWRIGHT_OBJECT.test(lastName(callee.object) ?? "")) {
          context.report({ node, messageId: "pageRoute", data: { name: method } });
        }
      },
    };
  },
};
