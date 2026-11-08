import { sharedTypesOnly } from "../rules/shared-types-only.ts";
import { tester } from "./tester.ts";

const runtime = [{ messageId: "runtime" }];

tester.run("shared-types-only", sharedTypesOnly, {
  valid: [
    "export type Option = { id: number };",
    "export interface Note { id: number }",
    "type Local = string; export type { Local };",
    "import type { A } from './a';",
    "export type { A } from './a';",
    "export type * from './a';",
  ],
  invalid: [
    { code: "export const LIMIT = 10;", errors: runtime },
    { code: "export function f() {}", errors: runtime },
    { code: "export class A {}", errors: runtime },
    { code: "export enum Status { A }", errors: runtime },
    { code: "import { a } from './a';", errors: runtime },
    { code: "import { type A } from './a';", errors: runtime },
    { code: "import './side-effect';", errors: runtime },
    { code: "export { a } from './a';", errors: runtime },
    { code: "export * from './a';", errors: runtime },
    { code: "console.log(1);", errors: runtime },
  ],
});
