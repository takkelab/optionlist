import { noTopLevelFunction } from "../rules/no-top-level-function.ts";
import { tester } from "./tester.ts";

const allowStatements = [{ allowTopLevelStatements: true }];
const allowHooks = [{ allowHooks: true }];

tester.run("no-top-level-function", noTopLevelFunction, {
  valid: [
    "class A implements I { run() { const f = () => 1; return f(); } }",
    "const LIMIT = 10;",
    "export const app = express();",
    "export const Ctx = createContext(null);",
    "import x from 'x'; export type T = string; export interface I {}",
    "export default defineConfig({});",
    "export { a } from './a';",
    "'use strict';",
    "export default defineConfig({ plugins: [react()] });",
    // 配列・Promise のメソッドに渡す関数は値の計算なので対象外
    "export const IDS = ITEMS.map((item) => item.id);",
    "export const RULES = Object.fromEntries(Object.keys(X).map((rule) => [rule, 'off']));",
    // frontend のフック（設定で allowHooks を渡す）
    { code: "export function useOptions() {}", options: allowHooks },
    { code: "export const useOptions = () => {};", options: allowHooks },
    // .tsx の React コンポーネント
    { code: "export function App() { return null; }\nexport default App;", filename: "App.tsx" },
    { code: "const Item = () => null;", filename: "Item.tsx" },
    { code: "export const Item = memo(() => null);", filename: "Item.tsx" },
    { code: "export default function App() { return null; }", filename: "App.tsx" },
    // エントリーポイントとテストではトップレベルの文を許す
    { code: "createApp().listen(8000);", options: allowStatements },
    { code: "describe('a', () => { it('b', () => {}); });", options: allowStatements },
  ],
  invalid: [
    { code: "function createApp() {}", errors: [{ messageId: "topLevelFunction" }] },
    { code: "export function createApp() {}", errors: [{ messageId: "topLevelFunction" }] },
    { code: "export async function getHealth() {}", errors: [{ messageId: "topLevelFunction" }] },
    { code: "const f = () => 1;", errors: [{ messageId: "topLevelFunction" }] },
    { code: "export const f = function () {};", errors: [{ messageId: "topLevelFunction" }] },
    { code: "const f = (() => 1) satisfies F;", errors: [{ messageId: "topLevelFunction" }] },
    { code: "export default () => 1;", errors: [{ messageId: "topLevelFunction" }] },
    { code: "export default function () {}", errors: [{ messageId: "topLevelFunction" }] },
    // 大文字の関数でも .tsx 以外はコンポーネントとみなさない
    { code: "export function App() {}", filename: "a.ts", errors: [{ messageId: "topLevelFunction" }] },
    { code: "function helper() {}", filename: "App.tsx", errors: [{ messageId: "topLevelFunction" }] },
    // テストでも関数は禁止（フェイクのクラスにする）
    { code: "const make = () => ({});", options: allowStatements, errors: [{ messageId: "topLevelFunction" }] },
    // フックの例外は allowHooks のときだけ（backend・shared では使えない）
    { code: "export function useParse() {}", errors: [{ messageId: "topLevelFunction" }] },
    // 値の中に入れた関数
    { code: "export const handlers = { list: async (req, res) => {} };", errors: [{ messageId: "topLevelFunction" }] },
    { code: "export const handlers = { list() {} };", errors: [{ messageId: "topLevelFunction" }] },
    { code: "export const handler = asyncHandler(async (req, res) => {});", errors: [{ messageId: "topLevelFunction" }] },
    { code: "export const steps = [() => 1];", errors: [{ messageId: "topLevelFunction" }] },
    { code: "export const router = Router().get('/', async (req, res) => {});", errors: [{ messageId: "topLevelFunction" }] },
    { code: "export const router = express.Router().post('/', async () => {}).get('/', list);", errors: [{ messageId: "topLevelFunction" }] },
    { code: "export const handlers = Object.freeze({ f: () => {} });", errors: [{ messageId: "topLevelFunction" }] },
    { code: "export default defineConfig({ configure: () => {} });", errors: [{ messageId: "topLevelFunction" }] },
    { code: "const Item = memo(() => null);", filename: "item.ts", errors: [{ messageId: "topLevelFunction" }] },
    { code: "router.get('/', handler);", errors: [{ messageId: "topLevelStatement" }] },
    { code: "if (x) { run(); }", errors: [{ messageId: "topLevelStatement" }] },
  ],
});
