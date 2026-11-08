import { noDoubleCast } from "../rules/no-double-cast.ts";
import { tester } from "./tester.ts";

tester.run("no-double-cast", noDoubleCast, {
  valid: ["const a = b as string;", "const a = b as unknown;", "const a = <string>b;"],
  invalid: [
    { code: "const a = b as unknown as string;", errors: [{ messageId: "doubleCast" }] },
    { code: "const a = <string><unknown>b;", errors: [{ messageId: "doubleCast" }] },
  ],
});
