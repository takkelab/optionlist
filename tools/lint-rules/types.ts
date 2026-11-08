import type { RuleTester } from "oxlint/plugins-dev";

// oxlint は Rule・Context・AST の型を公開していないので、RuleTester の引数から取り出す
export type Rule = Parameters<RuleTester["run"]>[1];
export type CreateRule = Extract<Rule, { create: unknown }>;
export type Context = Parameters<CreateRule["create"]>[0];
export type Visitor = ReturnType<CreateRule["create"]>;
export type NodeOf<K extends keyof Visitor> = Parameters<NonNullable<Visitor[K]>>[0];
export type Expression = NodeOf<"MemberExpression">["object"];
export type Statement = NodeOf<"Program">["body"][number];
