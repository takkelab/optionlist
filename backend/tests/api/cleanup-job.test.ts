import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PgPoolFactory } from "../../src/infra/PgPoolFactory";
import { CleanupFixtures } from "../fakes/CleanupFixtures";
import { CleanupHarness } from "../fakes/CleanupHarness";
import { TestDatabase } from "../fakes/TestDatabase";

// 削除のジョブ（data.md §5、testing.md §2）。本物のテスト用 DB に、本番と同じ ol_cleanup（CLEANUP_DATABASE_URL）でつなぐ
// 前提の行は ol_migrator（DATABASE_URL）で作る。時計はフェイク。境目は「期限ちょうどは残す」（docs/decisions/0059）
const pool = new PgPoolFactory(process.env, console, "DATABASE_URL").create();
const cleanupPool = new PgPoolFactory(process.env, console, "CLEANUP_DATABASE_URL").create();
const data = new TestDatabase(pool);
const seeds = new CleanupFixtures(pool);
const SECOND = 1000;
const DAY = 24 * 60 * 60 * SECOND;
// 日本時間の 4 時
const NOW = "2026-11-11T19:00:00.000Z";
const NOW_MS = Date.parse(NOW);
// PostgreSQL の interval '5 years' と同じく、暦で 5 年前
const FIVE_YEARS_AGO_MS = Date.UTC(2021, 10, 11, 19);

beforeEach(async () => {
  await data.reset();
});

afterAll(async () => {
  await data.reset();
  await Promise.all([pool.end(), cleanupPool.end()]);
});

describe("accounts not used for 5 years", () => {
  it("deletes them with their items, achievements and photos, and keeps the ones at or after the boundary", async () => {
    const job = new CleanupHarness(cleanupPool, NOW);
    const photos = [await job.savePhoto("a"), await job.savePhoto("b"), await job.savePhoto("c")];
    const ids: number[] = [];
    for (const [i, offset] of [-SECOND, 0, SECOND].entries()) {
      const userId = await seeds.user(new Date(FIVE_YEARS_AGO_MS + offset));
      await seeds.achievement(userId, await seeds.option(userId), photos[i] ?? null);
      ids.push(userId);
    }
    const counts = await job.run();
    expect(await seeds.userIds()).toEqual(ids.slice(1));
    expect(await seeds.counts()).toMatchObject({ options: 2, achievements: 2 });
    expect(job.photoNames()).toEqual(photos.slice(1));
    expect(counts).toMatchObject({ inactiveAccounts: 1, emptyAccounts: 0, accountPhotos: 1 });
  });
});

describe("accounts without items or achievements", () => {
  it("deletes the ones not used for 30 days, and keeps the ones at or after the boundary", async () => {
    await seeds.user(new Date(NOW_MS - 30 * DAY - SECOND));
    const exact = await seeds.user(new Date(NOW_MS - 30 * DAY));
    const after = await seeds.user(new Date(NOW_MS - 30 * DAY + SECOND));
    const counts = await new CleanupHarness(cleanupPool, NOW).run();
    expect(await seeds.userIds()).toEqual([exact, after]);
    expect(counts).toMatchObject({ inactiveAccounts: 0, emptyAccounts: 1 });
  });

  it("keeps an account with an item or an achievement, even when it has not been used for 30 days", async () => {
    const withItem = await seeds.user(new Date(NOW_MS - 365 * DAY));
    await seeds.option(withItem);
    const withAchievement = await seeds.user(new Date(NOW_MS - 365 * DAY));
    await seeds.achievement(withAchievement, await seeds.option(withAchievement), null);
    await new CleanupHarness(cleanupPool, NOW).run();
    expect(await seeds.userIds()).toEqual([withItem, withAchievement]);
    expect(await seeds.counts()).toMatchObject({ options: 2, achievements: 1 });
  });
});

describe("events and auth_attempts", () => {
  it("deletes events received more than 90 days ago", async () => {
    for (const offset of [-SECOND, 0, SECOND]) await seeds.event(new Date(NOW_MS - 90 * DAY + offset));
    const counts = await new CleanupHarness(cleanupPool, NOW).run();
    const { events } = await seeds.counts();
    expect([counts.events, events]).toEqual([1, 2]);
  });

  it("deletes auth_attempts more than 7 days old", async () => {
    for (const offset of [-SECOND, 0, SECOND]) await seeds.authAttempt(new Date(NOW_MS - 7 * DAY + offset));
    const counts = await new CleanupHarness(cleanupPool, NOW).run();
    const { authAttempts } = await seeds.counts();
    expect([counts.authAttempts, authAttempts]).toEqual([1, 2]);
  });
});

describe("photo files no row points to", () => {
  it("deletes the ones saved more than 1 day ago, and keeps newer ones and the ones a row points to", async () => {
    const job = new CleanupHarness(cleanupPool, new Date(NOW_MS - DAY - SECOND).toISOString());
    await job.savePhoto("old");
    const referenced = await job.savePhoto("kept");
    job.advance(SECOND);
    const exact = await job.savePhoto("exact");
    job.advance(SECOND);
    const newer = await job.savePhoto("new");
    const userId = await seeds.user(new Date(NOW_MS));
    await seeds.achievement(userId, await seeds.option(userId), referenced);
    // 時計を NOW に進めてから流す
    job.advance(DAY - SECOND);
    const counts = await job.run();
    expect(job.photoNames()).toEqual([referenced, exact, newer]);
    expect(counts.orphanPhotos).toBe(1);
  });
});

describe("the result", () => {
  it("logs the counts per kind without IDs or file names", async () => {
    const job = new CleanupHarness(cleanupPool, NOW);
    const photo = await job.savePhoto("a");
    const userId = await seeds.user(new Date(NOW_MS - 6 * 365 * DAY));
    await seeds.achievement(userId, await seeds.option(userId), photo);
    await seeds.user(new Date(NOW_MS - 31 * DAY));
    await seeds.event(new Date(NOW_MS - 91 * DAY));
    await seeds.authAttempt(new Date(NOW_MS - 8 * DAY));
    await job.run();
    const counts = { inactiveAccounts: 1, emptyAccounts: 1, accountPhotos: 1, events: 1, authAttempts: 1, orphanPhotos: 0 };
    expect(job.infos()).toEqual([{ kind: "cleanup_result", message: "保存期間を過ぎたものを消した", counts }]);
    expect(JSON.stringify(job.infos())).not.toContain(photo);
  });

  it("deletes the rows and succeeds even when a photo file cannot be removed", async () => {
    const job = new CleanupHarness(cleanupPool, NOW);
    const photo = await job.savePhoto("a");
    const userId = await seeds.user(new Date(NOW_MS - 6 * 365 * DAY));
    await seeds.achievement(userId, await seeds.option(userId), photo);
    job.failRemoving();
    const counts = await job.run();
    expect(await seeds.counts()).toMatchObject({ users: 0, options: 0, achievements: 0 });
    expect([counts.inactiveAccounts, counts.accountPhotos]).toEqual([1, 0]);
    expect(job.errorKinds()).toEqual(["orphan_file_error"]);
  });

  // 消せなかったファイルは次の日の「行のない写真」で拾う。同じ実行でもう一度試さない（data.md §5）
  it("does not retry an account's photo that failed in the same run", async () => {
    const job = new CleanupHarness(cleanupPool, new Date(NOW_MS - 2 * DAY).toISOString());
    const photo = await job.savePhoto("old");
    const userId = await seeds.user(new Date(NOW_MS - 6 * 365 * DAY));
    await seeds.achievement(userId, await seeds.option(userId), photo);
    job.advance(2 * DAY);
    job.failRemoving();
    const counts = await job.run();
    expect([counts.accountPhotos, counts.orphanPhotos]).toEqual([0, 0]);
    expect(job.errorKinds()).toEqual(["orphan_file_error"]);
    expect(job.photoNames()).toEqual([photo]);
  });

  it("counts an account not used for 5 years as inactive, even without items", async () => {
    await seeds.user(new Date(NOW_MS - 6 * 365 * DAY));
    const counts = await new CleanupHarness(cleanupPool, NOW).run();
    expect([counts.inactiveAccounts, counts.emptyAccounts]).toEqual([1, 0]);
  });

  it("deletes nothing when nothing is past its retention", async () => {
    const userId = await seeds.user(new Date(NOW_MS));
    await seeds.option(userId);
    const counts = await new CleanupHarness(cleanupPool, NOW).run();
    expect(Object.values(counts)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(await seeds.userIds()).toEqual([userId]);
  });
});
