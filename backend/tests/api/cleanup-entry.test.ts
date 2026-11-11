import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PgPoolFactory } from "../../src/infra/PgPoolFactory";
import { CleanupEntry } from "../../src/jobs/CleanupEntry";
import { CleanupFixtures } from "../fakes/CleanupFixtures";
import { FakeLogger } from "../fakes/FakeLogger";
import { TestDatabase } from "../fakes/TestDatabase";

// 削除のジョブの組み立てと終了コード（data.md §5。docs/decisions/0059）。DB は本物のテスト用 DB に ol_cleanup でつなぐ
const pool = new PgPoolFactory(process.env, console, "DATABASE_URL").create();
const data = new TestDatabase(pool);
const seeds = new CleanupFixtures(pool);
const uploadDir = mkdtempSync(join(tmpdir(), "optionlist-cleanup-entry-"));
// 手元の .env.test の写真の設定に左右されないよう、写真は一時フォルダに置く
const { PHOTO_BUCKET: _bucket, APP_ENV: _appEnv, ...baseEnv } = process.env;
const localEnv: NodeJS.ProcessEnv = { ...baseEnv, UPLOAD_DIR: uploadDir };

beforeEach(async () => {
  await data.reset();
});

afterAll(async () => {
  await data.reset();
  rmSync(uploadDir, { recursive: true, force: true });
  await pool.end();
});

describe("CleanupEntry", () => {
  it("runs the job with ol_cleanup, logs the result and returns 0", async () => {
    await seeds.user(new Date(Date.now() - 31 * 24 * 60 * 60 * 1000));
    const log = new FakeLogger();
    expect(await new CleanupEntry(localEnv, log).run()).toBe(0);
    expect(log.infos().map(({ kind, counts }) => [kind, counts?.emptyAccounts])).toEqual([["cleanup_result", 1]]);
    expect(await seeds.userIds()).toEqual([]);
  });

  it("logs cleanup_failed and returns 1 without CLEANUP_DATABASE_URL", async () => {
    const { CLEANUP_DATABASE_URL: _url, ...env } = localEnv;
    const log = new FakeLogger();
    expect(await new CleanupEntry(env, log).run()).toBe(1);
    expect(log.entries().map((entry) => entry.kind)).toEqual(["cleanup_failed"]);
  });

  // 確認用・本番で入れ物の名前が抜けたら、手元のフォルダを見て「写真も消した」と成功に見せない
  it.each(["staging", "production"])("refuses to run without PHOTO_BUCKET when APP_ENV=%s", async (appEnv) => {
    await seeds.user(new Date(Date.now() - 31 * 24 * 60 * 60 * 1000));
    const log = new FakeLogger();
    expect(await new CleanupEntry({ ...localEnv, APP_ENV: appEnv }, log).run()).toBe(1);
    expect(log.entries().map((entry) => entry.kind)).toEqual(["cleanup_failed"]);
    expect(await seeds.userIds()).toHaveLength(1);
  });

  it("logs cleanup_failed and returns 1 when the database cannot be reached", async () => {
    const log = new FakeLogger();
    const env = { ...localEnv, CLEANUP_DATABASE_URL: "postgres://ol_cleanup:wrong@127.0.0.1:1/optionlist_test?sslmode=disable" };
    expect(await new CleanupEntry(env, log).run()).toBe(1);
    expect(log.entries().map((entry) => entry.kind)).toEqual(["cleanup_failed"]);
  });
});
