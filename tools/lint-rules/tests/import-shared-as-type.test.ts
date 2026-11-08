import { importSharedAsType } from "../rules/import-shared-as-type.ts";
import { tester } from "./tester.ts";

const valueImport = [{ messageId: "valueImport" }];

tester.run("import-shared-as-type", importSharedAsType, {
  valid: [
    "import type { Option } from '../../shared/types';",
    "export type { Option } from '../shared/types';",
    "import type { Option } from '../../shared/types.ts';",
    // shared 以外は対象外
    "import { a } from './sharedHelpers';",
    "import express from 'express';",
  ],
  invalid: [
    { code: "import { Option } from '../../shared/types';", errors: valueImport },
    { code: "import { type Option, LIMIT } from '../shared/types';", errors: valueImport },
    // verbatimModuleSyntax だと実行時に import が残る
    { code: "import { type Option } from '../../shared/types.ts';", errors: valueImport },
    { code: "export { type Option } from '../shared/types';", errors: valueImport },
    { code: "import * as types from '../shared/types';", errors: valueImport },
    { code: "import '../shared/types';", errors: valueImport },
    { code: "export { Option } from '../shared/types';", errors: valueImport },
    { code: "export * from '../shared/types';", errors: valueImport },
  ],
});
