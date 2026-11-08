import { lawOfDemeter } from "../rules/law-of-demeter.ts";
import { tester } from "./tester.ts";

const chain = [{ messageId: "chain" }];

tester.run("law-of-demeter", lawOfDemeter, {
  valid: [
    "option.title;",
    "a.b();",
    "class A { run() { return this.repo.find(1); } }",
    "class A { #repo; run() { return this.#repo.find(1); } }",
    "class A { #items = []; run() { return this.#items[0]; } }",
    // 戻り値に続く許可リストのメソッド
    "rows.map((r) => r.id).filter(Boolean).join(',');",
    "this.repo.findAll().map((o) => o.id);",
    "async function f() { return (await this.repo.findAll()).map((o) => o.id); }",
    "res.status(503).json({});",
    "res.status(204).end();",
    "getHealth().then((r) => r.status).catch((e) => e.message);",
    "Object.keys(o).length;",
    "s.trim().toLowerCase();",
    // 呼び出しの戻り値に 1 段はよい
    "createRoot(el).render(app);",
    "request(app).get('/api/health');",
    "new Foo().bar();",
    // テストの expect
    "expect(res.status).toBe(200);",
    "expect(x).not.toBe(1);",
    "await expect(p).rejects.toThrow();",
    // 環境変数と名前空間 import
    "Number(process.env.DB_PORT);",
    "import.meta.env.VITE_X;",
    "import * as fs from 'node:fs'; fs.promises.readFile('a');",
    // 型の位置は対象外
    "let x: React.FC.Props;",
  ],
  invalid: [
    { code: "a.b.c;", errors: chain },
    { code: "a.b.c();", errors: chain },
    { code: "a.b().c;", errors: chain },
    { code: "a.b().c();", errors: chain },
    { code: "a?.b?.c;", errors: chain },
    { code: "a.b!.c;", errors: chain },
    { code: "async function f() { return (await a.b()).c; }", errors: chain },
    { code: "async function f() { return (await this.repo.findById(1)).title; }", errors: chain },
    { code: "(<T>a.b).c;", errors: chain },
    { code: "args[0].type;", errors: chain },
    { code: "class A { run() { return this.repo.items.length; } }", errors: chain },
    { code: "res.body.status;", errors: chain },
    { code: "JSON.parse(text).metadata;", errors: chain },
    { code: "process.env.X.length;", errors: chain },
    // 1 本のチェーンは 1 回だけ報告する
    { code: "a.b.c.d.e();", errors: chain },
    { code: "x = a.b.c + d.e.f;", errors: [...chain, ...chain] },
  ],
});
