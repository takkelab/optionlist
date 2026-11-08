import { noPublicField } from "../rules/no-public-field.ts";
import { tester } from "./tester.ts";

tester.run("no-public-field", noPublicField, {
  valid: [
    "class A { #x = 1; }",
    "class A { private x = 1; }",
    "class A { private readonly x: number; }",
    "class A { constructor(private readonly repo: Repo) {} }",
    "class A { static x = 1; }",
    "class A { get x() { return 1; } }",
    "export const x = 1;",
    "const o = { x: 1 };",
  ],
  invalid: [
    { code: "class A { x = 1; }", errors: [{ messageId: "publicField" }] },
    { code: "class A { public x = 1; }", errors: [{ messageId: "publicField" }] },
    { code: "class A { protected x = 1; }", errors: [{ messageId: "publicField" }] },
    { code: "class A { readonly x = 1; }", errors: [{ messageId: "publicField" }] },
    { code: "class A { accessor x = 1; }", errors: [{ messageId: "publicField" }] },
    { code: "class A { constructor(readonly repo: Repo) {} }", errors: [{ messageId: "publicField" }] },
    { code: "class A { constructor(public repo: Repo) {} }", errors: [{ messageId: "publicField" }] },
    { code: "export let x = 1;", errors: [{ messageId: "exportLet" }] },
  ],
});
