import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CssDesignTokenChecker } from "../lib/design-token-checker.ts";
import { CommentLintDisableDetector } from "../lib/lint-disable-detector.ts";
import { OxcParsedSource } from "../lib/source-file.ts";
import { AstSwallowedExceptionDetector } from "../lib/swallowed-exception-detector.ts";

const parse = (code: string, file = "a.ts") => new OxcParsedSource(file, code);

describe("AstSwallowedExceptionDetector", () => {
  const detect = (code: string) => new AstSwallowedExceptionDetector().detect("a.ts", parse(code));

  it("空の catch・何もしない .catch() を検出する", () => {
    const found = detect("try { a(); } catch (e) {}\np.catch(() => {});\nq.catch(function () {});");
    assert.deepEqual(
      found.map((f) => f.line),
      [1, 2, 3],
    );
  });

  it("ログも再送出も応答もしない catch を検出する", () => {
    assert.equal(detect("try { a(); } catch { return null; }").length, 1);
    assert.equal(detect("p.catch(() => undefined);").length, 1);
  });

  it("再送出・ログ・応答・エラーの受け渡しは握り潰しとみなさない", () => {
    const handled = [
      "try { a(); } catch (e) { throw new Error('x', { cause: e }); }",
      "try { a(); } catch { console.error('failed'); }",
      "try { a(); } catch { logger.warn('failed'); }",
      "try { a(); } catch { res.status(503).json({}); }",
      "try { a(); } catch { next(new Error('x')); }",
      "p.catch((e: Error) => setMessage(e.message));",
      "p.catch((err) => next(err));",
    ];
    for (const code of handled) assert.deepEqual(detect(code), [], code);
  });

  it(".catch でない呼び出しは対象外", () => {
    assert.deepEqual(detect("p.then(() => {});"), []);
  });

  it("エラーと同じ名前がキーやプロパティ名に出てくるだけなら握り潰し", () => {
    assert.equal(detect("try { a(); } catch (error) { return { error: null }; }").length, 1);
    assert.equal(detect("try { a(); } catch (e) { x.e = 1; }").length, 1);
    assert.deepEqual(detect("try { a(); } catch (error) { return { error }; }"), []);
    assert.deepEqual(detect("try { a(); } catch (e) { x[e] = 1; }"), []);
  });

  it(".then の第 2 引数と、名前で渡したハンドラも検査する", () => {
    assert.equal(detect("p.then(ok, () => {});").length, 1);
    assert.equal(detect("p.catch(noop);").length, 1);
    assert.deepEqual(detect("p.catch(next);\nq.catch(console.error);\nr.then(ok, (e) => fail(e));"), []);
  });
});

describe("OxcParsedSource", () => {
  it("構文エラーを返す", () => {
    assert.equal(parse("const = ;").errors().length > 0, true);
    assert.deepEqual(parse("const a = 1;").errors(), []);
  });
});

describe("CommentLintDisableDetector", () => {
  const detect = (code: string) => new CommentLintDisableDetector().detect("a.ts", parse(code));

  it("lint や型チェックを止めるコメントを検出する", () => {
    const code = [
      "// oxlint-disable-next-line no-console",
      "/* eslint-disable */",
      "// @ts-ignore",
      "// @ts-expect-error",
      "// @ts-nocheck",
    ].join("\nconst x = 1;\n");
    assert.equal(detect(code).length, 5);
  });

  it("文字列の中や普通のコメントは対象外", () => {
    assert.deepEqual(detect("// 説明のコメント\nconst s = 'oxlint-disable';"), []);
  });
});

describe("CssDesignTokenChecker", () => {
  const checker = new CssDesignTokenChecker();

  it("tokens.css の色・文字サイズ・余白のトークンを数える", () => {
    const css = ":root { --color-bg: #fff; --color-text: #111; --font-size-md: 16px; --space-1: 4px; --space-2: 8px; /* --color-x: red; */ }";
    assert.deepEqual(checker.countTokens(css), { colors: 2, decoColors: 0, fontSizes: 1, spacings: 2 });
  });

  it("装飾の色（--deco-*）は色の数から除き、別に数える", () => {
    const css = [
      ":root { --color-bg: #fff; --deco-1: #e0a800; --deco-2: #ef5b2e; --deco-3: #E0A800;",
      "  --deco-rainbow: linear-gradient(135deg, var(--deco-1), var(--deco-2)); --color-text: #111; }",
    ].join("\n");
    assert.deepEqual(checker.countTokens(css), { colors: 2, decoColors: 2, fontSizes: 0, spacings: 0 });
  });

  it("装飾の色を縁以外に使った宣言を検出する（変数を通した使い方も含む）", () => {
    const sheets = [
      { file: "theme.css", css: ".c1 { --theme-color: var(--deco-1); }\n.dot { border: 5px solid var(--theme-color); }" },
      {
        file: "card.css",
        css: [
          ".a { box-shadow: inset 0 3px 0 var(--theme-color, transparent), 0 1px 4px var(--color-shadow); }",
          ".b { color: var(--deco-2); }",
          ".c { background: var(--theme-color); }",
          ".d { background: linear-gradient(var(--color-bg), var(--color-bg)) padding-box, var(--deco-rainbow) border-box; }",
          ".e { border-top-color: var(--deco-3); outline: 2px solid var(--deco-4); }",
          ".f { fill: var(--theme-color); }",
        ].join("\n"),
      },
    ];
    const found = checker.findDecoMisuse(sheets);
    assert.deepEqual(
      found.map((f) => `${f.file}:${f.line}`),
      ["card.css:2", "card.css:3", "card.css:6"],
    );
  });

  it("tokens.css の別名・別名の別名も、ファイルの順番に関係なく追う", () => {
    const sheets = [
      { file: "a.css", css: ".a { background: var(--b-color); }\n.b { color: var(--x); }" },
      { file: "b.css", css: ".c { --b-color: var(--theme-color); }" },
      { file: "tokens.css", css: ":root { --x: var(--deco-1); }" },
      { file: "theme.css", css: ".c1 { --theme-color: var(--deco-1); }" },
    ];
    assert.deepEqual(
      checker.findDecoMisuse(sheets).map((f) => `${f.file}:${f.line}`),
      ["a.css:1", "a.css:2"],
    );
  });

  it("background は、装飾の色の層が border-box にあり padding-box の層が上を覆う形だけを縁とみなす", () => {
    const css = [
      ".ok { background: linear-gradient(var(--color-bg), var(--color-bg)) padding-box, var(--deco-rainbow) border-box; }",
      ".fill { background: var(--deco-1) border-box; }",
      ".inside { background: var(--deco-1) padding-box, var(--color-bg) border-box; }",
      ".decoTop { background: var(--deco-2) padding-box, var(--deco-rainbow) border-box; }",
    ].join("\n");
    assert.deepEqual(
      checker.findDecoMisuse([{ file: "a.css", css }]).map((f) => f.line),
      [2, 3, 4],
    );
  });

  it("追加ボタンの粒の background だけは例外で、同じファイルのほかのプロパティとほかのファイルは検出する（docs/decisions/0027）", () => {
    const css = ".particle { background: var(--deco-1); color: var(--deco-1); }";
    assert.deepEqual(
      checker.findDecoMisuse([{ file: "src/AddButton.module.css", css }]).map((f) => f.message),
      ["装飾の色を color に使っている（縁: border・box-shadow・outline にだけ使う）"],
    );
    assert.equal(checker.findDecoMisuse([{ file: "src/Other.module.css", css }]).length, 2);
  });

  it("TS/TSX の文字列で装飾の色を使った箇所を検出する", () => {
    const code = [
      "const a = { color: 'var(--deco-1)' };",
      "const b = { borderColor: 'var(--theme-color)' };",
      "const c = 'var(--color-text)';",
    ].join("\n");
    const found = checker.findDecoInScript("a.tsx", parse(code, "a.tsx"));
    assert.deepEqual(
      found.map((f) => f.line),
      [1, 2],
    );
  });

  it("装飾の色を使っていない宣言とコメントは対象外", () => {
    const sheets = [{ file: "a.css", css: "/* color: var(--deco-1) */\n.a { color: var(--color-text); background: var(--color-bg); }" }];
    assert.deepEqual(checker.findDecoMisuse(sheets), []);
  });

  it("色は名前に関係なく値の種類で数える", () => {
    const css = [
      ":root { --color-bg: #FFF; --bg2: rgb(0, 0, 0); --shadow: 0 1px 2px rgba(0,0,0,.2); }",
      "@media (prefers-color-scheme: dark) { :root { --color-bg: #fff; --color-text: rgb(0 , 0, 0); } }",
    ].join("\n");
    assert.equal(checker.countTokens(css).colors, 3);
  });

  it("CSS の宣言にある色の直書きを検出する", () => {
    const css = ".a {\n  color: #abc;\n  background: rgba(0, 0, 0, 0.5);\n}\n.b { border-color: hsl(0 0% 0%) }";
    assert.deepEqual(
      checker.findHardcodedColorsInCss("a.css", css).map((f) => f.line),
      [2, 3, 5],
    );
  });

  it("CSS の変数参照・セレクタ・コメントは対象外", () => {
    const css = "/* #fff */\n#add:hover { color: var(--color-text); }\n.c { width: calc(100% - 4px); }";
    assert.deepEqual(checker.findHardcodedColorsInCss("a.css", css), []);
  });

  it("TSX の文字列とテンプレートの中の色を検出し、#private は対象外", () => {
    const code = [
      "class A { #fade = 1; }",
      "const s = { color: '#ff0000' };",
      "const t = `rgb(${1}, 2, 3)`;",
      "const el = <div color=\"#000\">#abc</div>;",
    ].join("\n");
    const found = checker.findHardcodedColorsInScript("a.tsx", parse(code, "a.tsx"));
    assert.deepEqual(
      found.map((f) => f.line),
      [2, 3, 4],
    );
  });
});
