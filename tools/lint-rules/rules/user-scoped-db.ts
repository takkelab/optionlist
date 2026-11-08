import type { CreateRule, Expression, NodeOf } from "../types.ts";

// L13: 利用者のデータには UserScopedDatabase 越しにだけ触る（architecture.md §2、data.md §4、docs/decisions/0046）
// - SQL の文字列（テンプレートリテラルと、文字列の + の連結を含む）で、利用者の表（users・options・achievements）が
//   FROM・JOIN・INTO・UPDATE の後（スキーマ付き・引用符付き、FROM のコンマの並びを含む）に出てくるファイルは、
//   infra の UserScopes（forUser で UserScopedDatabase を作る口）を import し、生の Database を import しない
// - set_config と、文頭の SET（SET LOCAL を含む）は backend/src/infra/ の外に書かない（UPDATE … SET col = … は対象外）
// - pg を import してよいのは backend/src/infra/ だけ
// oxlint.config.ts で backend/src だけに効かせる。ファイルの場所はパスの一部で見る（RuleTester では filename で渡す）
const TABLE = String.raw`(?:"?public"?\.)?"?(?:users|options|achievements)\b`;
const USER_TABLE_SQL = new RegExp(String.raw`\b(?:FROM|JOIN|INTO|UPDATE)\s+${TABLE}|\bFROM\s[^;()]*,\s*${TABLE}`, "i");
const SET_SQL = /\bset_config\s*\(|(?:^|;)\s*SET\s/i;
const INFRA = /(?:^|\/)infra\//;
const DATABASE_MODULE = /(?:^|\/)infra\/PgDatabase(?:\.[cm]?[jt]s)?$/;
const PG_MODULE = /^pg(?:\/|$)/;
// 許可リスト（architecture.md §2 の L13 の例外）。認証の関数だけ・SELECT 1 だけ・events への INSERT だけを流すもの、削除のジョブ（ol_cleanup）
const ALLOWED = /(?:^|\/)(?:repositories\/(?:AccountRepository|HealthRepository|EventRepository)\.ts$|jobs\/)/;

type Reported = NodeOf<"Literal"> | NodeOf<"TemplateLiteral"> | NodeOf<"BinaryExpression">;

export const userScopedDb: CreateRule = {
  meta: {
    type: "problem",
    messages: {
      rawDatabase: "L13: 利用者の表（users・options・achievements）の SQL は UserScopes（UserScopedDatabase.run）越しに流す。生の Database を使わない",
      setConfig: "L13: set_config・SET は backend/src/infra/ の外に書かない（UserScopedDatabase.run が SET LOCAL する）",
      pgImport: "L13: pg を import してよいのは backend/src/infra/ だけ",
    },
  },
  create(context) {
    const filename = context.filename.replaceAll("\\", "/");
    const inInfra = INFRA.test(filename);
    const allowed = ALLOWED.test(filename);
    const state = { usesDatabase: false, usesScopes: false, firstUserSql: null as Reported | null };
    const check = (node: Reported, sql: string) => {
      if (!inInfra && SET_SQL.test(sql)) context.report({ node, messageId: "setConfig" });
      if (state.firstUserSql === null && USER_TABLE_SQL.test(sql)) state.firstUserSql = node;
    };
    // a + b + … の文字列の部分をつなぐ。文字列でない部分は 1 つの値として ? にする
    const concatenated = (node: Expression): string => {
      if (node.type === "BinaryExpression" && node.operator === "+") return concatenated(node.left as Expression) + concatenated(node.right);
      if (node.type === "Literal" && typeof node.value === "string") return node.value;
      if (node.type === "TemplateLiteral") return node.quasis.map((quasi) => quasi.value.raw).join("?");
      return "?";
    };
    return {
      ImportDeclaration(node) {
        const source = node.source.value;
        if (PG_MODULE.test(source) && !inInfra) context.report({ node, messageId: "pgImport" });
        if (!DATABASE_MODULE.test(source)) return;
        for (const specifier of node.specifiers) {
          if (specifier.type !== "ImportSpecifier") continue;
          const { imported } = specifier;
          const name = imported.type === "Identifier" ? imported.name : imported.value;
          if (name === "Database") state.usesDatabase = true;
          if (name === "UserScopes") state.usesScopes = true;
        }
      },
      Literal(node) {
        if (typeof node.value === "string") check(node, node.value);
      },
      // ${…} は 1 つの値として ? に置き換えてつなぐ（UPDATE ${table} SET を文頭の SET と見ない）
      TemplateLiteral(node) {
        check(node, node.quasis.map((quasi) => quasi.value.raw).join("?"));
      },
      // "SELECT … FROM " + "options" のような連結。いちばん外側の + でだけ見る
      BinaryExpression(node) {
        if (node.operator !== "+") return;
        const { parent } = node as { parent?: { type: string; operator?: string } };
        if (parent?.type === "BinaryExpression" && parent.operator === "+") return;
        check(node, concatenated(node));
      },
      "Program:exit"() {
        const node = state.firstUserSql;
        if (node === null || allowed || inInfra) return;
        if (state.usesDatabase || !state.usesScopes) context.report({ node, messageId: "rawDatabase" });
      },
    };
  },
};
