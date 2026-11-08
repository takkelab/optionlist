import { noStatic } from "../rules/no-static.ts";
import { tester } from "./tester.ts";

tester.run("no-static", noStatic, {
  valid: [
    "class A implements I { private x = 1; run() {} }",
    "const LIMIT = 10;",
    "export const LIMIT = 10;",
    "function f() { let x = 1; return x; }",
    "class A implements I { run() { let x = 1; return x; } }",
  ],
  invalid: [
    { code: "class A { static create() {} }", errors: [{ messageId: "staticMember" }] },
    { code: "class A { static count = 0; }", errors: [{ messageId: "staticMember" }] },
    { code: "class A { static accessor x = 1; }", errors: [{ messageId: "staticMember" }] },
    { code: "class A { static { init(); } }", errors: [{ messageId: "staticMember" }] },
    { code: "let count = 0;", errors: [{ messageId: "topLevelLet" }] },
    { code: "var count = 0;", errors: [{ messageId: "topLevelLet" }] },
  ],
});
