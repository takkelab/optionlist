import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DecisionRecordCheck, GitNameStatusParser, IncidentSectionCheck } from "../lib/pr-checks.ts";

describe("IncidentSectionCheck", () => {
  const check = (body: string) => new IncidentSectionCheck().check(body);

  it("見出しの下が空、または HTML コメントだけなら失敗", () => {
    assert.equal(check("## 概要\nx\n## 詰まった点と再発防止策\n\n## チェック\n- [x] a").length, 1);
    assert.equal(check("## 詰まった点と再発防止策\n<!-- 書き方の説明 -->\n").length, 1);
  });

  it("見出しがなければ失敗", () => {
    assert.equal(check("## 概要\nx").length, 1);
  });

  it("「なし」や内容が書いてあれば合格", () => {
    assert.deepEqual(check("## 詰まった点と再発防止策\r\n<!-- 説明 -->\r\nなし\r\n## チェック"), []);
    assert.deepEqual(check("### 詰まった点と再発防止策\n- ポート衝突 → 起動時チェック（環境）"), []);
  });
});

describe("DecisionRecordCheck", () => {
  const check = (changes: { status: string; path: string }[]) => new DecisionRecordCheck().check("", changes);

  it("metrics.config.json を変えて decisions の追加がなければ失敗", () => {
    assert.equal(check([{ status: "M", path: "metrics.config.json" }]).length, 1);
    assert.equal(
      check([
        { status: "M", path: "metrics.config.json" },
        { status: "M", path: "docs/decisions/0001-split-spec.md" },
      ]).length,
      1,
    );
  });

  it("decisions を追加していれば合格。config を変えていなければ対象外", () => {
    assert.deepEqual(
      check([
        { status: "M", path: "metrics.config.json" },
        { status: "A", path: "docs/decisions/0004-raise-coverage.md" },
      ]),
      [],
    );
    assert.deepEqual(check([{ status: "M", path: "backend/src/app.ts" }]), []);
  });
});

describe("GitNameStatusParser", () => {
  it("リネームは新しいパスを使う", () => {
    const output = "M\tmetrics.config.json\nA\tdocs/decisions/0004-x.md\nR100\told.ts\tnew.ts\n";
    assert.deepEqual(new GitNameStatusParser().parse(output), [
      { status: "M", path: "metrics.config.json" },
      { status: "A", path: "docs/decisions/0004-x.md" },
      { status: "R100", path: "new.ts" },
    ]);
  });
});
