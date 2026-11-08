import { noWideMock } from "../rules/no-wide-mock.ts";
import { tester } from "./tester.ts";

tester.run("no-wide-mock", noWideMock, {
  valid: [
    "const fake = new FakeRepo(); const fn = vi.fn();",
    // 自分で作ったフェイクへの spyOn はよい
    "const repo = new FakeRepo(); vi.spyOn(repo, 'find');",
    "vi.useFakeTimers();",
    "const clock = { now() { return 0; } }; vi.spyOn(clock, 'now');",
    // Express の router.route は対象外
    "router.route('/').get(handler);",
    "app.route('/x');",
  ],
  invalid: [
    { code: "vi.mock('../db');", errors: [{ messageId: "viMock" }] },
    { code: "vi.doMock('../db', () => ({}));", errors: [{ messageId: "viMock" }] },
    { code: "vi.stubGlobal('fetch', f);", errors: [{ messageId: "viMock" }] },
    { code: "import axios from 'axios'; vi.spyOn(axios, 'get');", errors: [{ messageId: "spyOnModule" }] },
    { code: "import * as fs from 'node:fs'; vi.spyOn(fs, 'readFileSync');", errors: [{ messageId: "spyOnModule" }] },
    { code: "import { pool } from '../db'; vi.spyOn(pool, 'query');", errors: [{ messageId: "spyOnModule" }] },
    { code: "vi.spyOn(console, 'error');", errors: [{ messageId: "spyOnModule" }] },
    { code: "vi.spyOn(globalThis.crypto, 'randomUUID');", errors: [{ messageId: "spyOnModule" }] },
    { code: "vi.spyOn(Date, 'now');", errors: [{ messageId: "spyOnModule" }] },
    // 一覧ではなく「ファイル内で宣言していない名前」で判定する
    { code: "vi.spyOn(URL, 'createObjectURL');", errors: [{ messageId: "spyOnModule" }] },
    { code: "vi.spyOn(HTMLCanvasElement.prototype, 'toBlob');", errors: [{ messageId: "spyOnModule" }] },
    { code: "vi.spyOn(Buffer, 'from');", errors: [{ messageId: "spyOnModule" }] },
    { code: "await page.route('**/api/**', handler);", errors: [{ messageId: "pageRoute" }] },
    { code: "await context.route('**/api/**', handler);", errors: [{ messageId: "pageRoute" }] },
    { code: "await this.page.route('**', handler);", errors: [{ messageId: "pageRoute" }] },
    { code: "await page.routeFromHAR('a.har');", errors: [{ messageId: "pageRoute" }] },
    { code: "await page.routeWebSocket('**', handler);", errors: [{ messageId: "pageRoute" }] },
  ],
});
