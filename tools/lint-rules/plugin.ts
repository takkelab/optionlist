import { classImplementsInterface } from "./rules/class-implements-interface.ts";
import { importSharedAsType } from "./rules/import-shared-as-type.ts";
import { lawOfDemeter } from "./rules/law-of-demeter.ts";
import { noDoubleCast } from "./rules/no-double-cast.ts";
import { noExtends } from "./rules/no-extends.ts";
import { noPublicField } from "./rules/no-public-field.ts";
import { noStatic } from "./rules/no-static.ts";
import { noTopLevelFunction } from "./rules/no-top-level-function.ts";
import { noWideMock } from "./rules/no-wide-mock.ts";
import { sharedTypesOnly } from "./rules/shared-types-only.ts";

// architecture.md §2 の自作ルール。ルール名は rules/ のファイル名と同じにし、テストは tests/<ルール名>.test.ts に置く
// （scripts/lib/lint-rule-test-checker.ts がこの対応でテストの有無を確かめる）
export default {
  meta: { name: "design" },
  rules: {
    "class-implements-interface": classImplementsInterface,
    "import-shared-as-type": importSharedAsType,
    "law-of-demeter": lawOfDemeter,
    "no-double-cast": noDoubleCast,
    "no-extends": noExtends,
    "no-public-field": noPublicField,
    "no-static": noStatic,
    "no-top-level-function": noTopLevelFunction,
    "no-wide-mock": noWideMock,
    "shared-types-only": sharedTypesOnly,
  },
};
