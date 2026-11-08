import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";

// architecture.md §3.1 の層の向き（backend と frontend）。oxlint.config.ts の no-restricted-imports はフォルダごとの設定なので、
// RuleTester ではなく、実際の層のフォルダに一時ファイルを置いて oxlint を 1 回だけ流す（docs/decisions/0007）
const cases: [dir: string, source: string, restricted: boolean][] = [
  ["backend/src/controllers", 'import type { HealthStore } from "../repositories/HealthRepository";', true],
  ["backend/src/controllers", 'import type { Database } from "../infra/PgDatabase";', true],
  ["backend/src/controllers", 'import type { HealthChecker } from "../services/HealthService";', false],
  ["backend/src/services", 'import type { Controller } from "../controllers/http";', true],
  ["backend/src/repositories", 'import type { HealthChecker } from "../services/HealthService";', true],
  ["backend/src/repositories", 'import type { Database } from "../infra/PgDatabase";', false],
  ["backend/src/infra", 'import type { HealthStore } from "../repositories/HealthRepository";', true],
  ["backend/src/middleware", 'import type { HealthChecker } from "../services/HealthService";', true],
  ["backend/src/middleware", 'import { AppError } from "../services/errors";', false],
  ["backend/src/metrics", 'import type { Database } from "../infra/PgDatabase";', true],
  ["frontend/src/features/options", 'import type { OptionsApi } from "../../api/client";', true],
  ["frontend/src/features/options", 'import axios from "axios";', true],
  ["frontend/src/features/options", 'import { useOptionsApi } from "../../app/hooks";', false],
  ["frontend/src/components", 'import type { OptionsApi } from "../api/client";', true],
  ["frontend/src/components", 'import { TitleRule } from "../lib/TitleRule";', false],
  ["frontend/src/components", 'import axios from "axios";', true],
  ["frontend/src/api", 'import { useNotifier } from "../app/hooks";', true],
  ["frontend/src/api", 'import axios from "axios";', false],
  ["frontend/src/api", 'import { WishListPage } from "../features/options/list/WishListPage";', true],
  ["frontend/src/api", 'import { Toast } from "../components/Toast";', true],
  ["frontend/src/lib", 'import { useNotifier } from "../app/hooks";', true],
  ["frontend/src/lib", 'import { Toast } from "../components/Toast";', true],
  ["frontend/src/lib", 'import { WishListPage } from "../features/options/list/WishListPage";', true],
  ["frontend/src/app", 'import type { OptionsApi } from "../api/client";', false],
];
const files = cases.map(([dir], i) => `${dir}/__layer_probe_${i}__.ts`);
const restrictedFiles = new Set<string>();

before(() => {
  cases.forEach(([, source], i) => writeFileSync(files[i], `${source}\nexport {};\n`));
  const { stdout } = spawnSync(`npx oxlint -f json ${files.join(" ")}`, { shell: true, encoding: "utf8" });
  const parsed = JSON.parse(stdout.slice(stdout.indexOf("{"), stdout.lastIndexOf("}") + 1)) as {
    diagnostics: { code: string; filename: string }[];
  };
  for (const d of parsed.diagnostics) {
    if (d.code === "eslint(no-restricted-imports)") restrictedFiles.add(d.filename.replaceAll("\\", "/"));
  }
});

after(() => {
  for (const file of files) rmSync(file, { force: true });
});

describe("layer imports (no-restricted-imports)", () => {
  cases.forEach(([dir, source, restricted], i) => {
    it(`${dir}: ${source} → ${restricted ? "違反" : "通る"}`, () => {
      assert.equal(restrictedFiles.has(files[i]), restricted);
    });
  });
});
