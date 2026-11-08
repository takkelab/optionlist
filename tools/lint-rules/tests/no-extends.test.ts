import { noExtends } from "../rules/no-extends.ts";
import { tester } from "./tester.ts";

tester.run("no-extends", noExtends, {
  valid: [
    "class A implements I {}",
    "class NotFoundError extends Error {}",
    "const E = class extends Error {};",
    "interface A extends B {}",
  ],
  invalid: [
    { code: "class A extends B {}", errors: [{ messageId: "extends" }] },
    { code: "class A extends ns.Error {}", errors: [{ messageId: "extends" }] },
    { code: "const A = class extends B {};", errors: [{ messageId: "extends" }] },
  ],
});
