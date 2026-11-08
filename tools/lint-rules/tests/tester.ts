import { describe, it } from "node:test";
import { RuleTester } from "oxlint/plugins-dev";

// RuleTester を node:test の describe / it で動かす。ファイル名を省いたテストは a.ts として扱う
RuleTester.describe = describe;
RuleTester.it = it;

export const tester = new RuleTester({ languageOptions: { sourceType: "module", parserOptions: { lang: "ts" } } });
