import { classImplementsInterface } from "../rules/class-implements-interface.ts";
import { tester } from "./tester.ts";

tester.run("class-implements-interface", classImplementsInterface, {
  valid: [
    "class A implements I {}",
    "class A implements I, J {}",
    "class NotFoundError extends Error {}",
    "const A = class implements I {};",
  ],
  invalid: [
    { code: "class A {}", errors: [{ messageId: "noInterface" }] },
    { code: "export default class {}", errors: [{ messageId: "noInterface" }] },
    { code: "const A = class {};", errors: [{ messageId: "noInterface" }] },
    { code: "class A extends B {}", errors: [{ messageId: "noInterface" }] },
  ],
});
