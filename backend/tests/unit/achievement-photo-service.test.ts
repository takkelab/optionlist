import { beforeEach, describe, expect, it } from "vitest";
import { PromMetrics } from "../../src/metrics/PromMetrics";
import { AchievementPhotoService } from "../../src/services/AchievementPhotoService";
import { PhotoCleanup } from "../../src/services/PhotoCleanup";
import { PhotoFormat } from "../../src/services/PhotoFormat";
import { FakeAchievementStore } from "../fakes/FakeAchievementStore";
import { FakeLogger } from "../fakes/FakeLogger";
import { FakePhotoFiles } from "../fakes/FakePhotoFiles";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const USER = 7;
const NOW = new Date("2026-11-06T00:00:00.000Z");

describe("AchievementPhotoService", () => {
  let store: FakeAchievementStore;
  let files: FakePhotoFiles;
  let metrics: PromMetrics;
  let logger: FakeLogger;
  let service: AchievementPhotoService;

  beforeEach(async () => {
    store = new FakeAchievementStore([1]);
    await store.insert(1, NOW);
    files = new FakePhotoFiles();
    metrics = new PromMetrics();
    logger = new FakeLogger();
    service = new AchievementPhotoService(store, files, new PhotoCleanup(files, metrics, logger), new PhotoFormat());
  });

  // 配信してよいのは、その人の達成の写真だけ。アカウントがない人には store に聞かずに配らない（api.md §5）
  it("serves only the photo of the person's own achievement", async () => {
    await service.set(USER, 1, JPEG);
    expect(await service.canServe(USER, "photo-1.jpg")).toBe(true);
    expect(await service.canServe(USER, "photo-9.jpg")).toBe(false);
    const asked = store.users().length;
    expect(await service.canServe(null, "photo-1.jpg")).toBe(false);
    expect(store.users()).toHaveLength(asked);
  });

  it("saves the photo and returns the achievement with its URL", async () => {
    expect(await service.set(USER, 1, JPEG)).toMatchObject({ id: 1, photoUrl: "/api/photos/photo-1.jpg" });
    expect(files.names()).toEqual(["photo-1.jpg"]);
  });

  it("replaces the photo and removes the old file", async () => {
    await service.set(USER, 1, JPEG);
    expect(await service.set(USER, 1, JPEG)).toMatchObject({ photoUrl: "/api/photos/photo-2.jpg" });
    expect(files.names()).toEqual(["photo-2.jpg"]);
  });

  it("still saves the new photo when the old file cannot be removed, and counts it", async () => {
    await service.set(USER, 1, JPEG);
    files.failRemoving();
    expect(await service.set(USER, 1, JPEG)).toMatchObject({ photoUrl: "/api/photos/photo-2.jpg" });
    expect(logger.errors()).toHaveLength(1);
    expect(await metrics.render()).toContain("orphan_file_errors_total 1");
  });

  it("writes no file for bytes that are not a photo", async () => {
    await expect(service.set(USER, 1, Buffer.from("<svg></svg>"))).rejects.toThrow("JPEG");
    expect(files.names()).toEqual([]);
  });

  it("writes no file for an achievement that does not exist", async () => {
    await expect(service.set(USER, 2, JPEG)).rejects.toThrow("が見つからない");
    expect(files.names()).toEqual([]);
  });

  it("removes the new file when the row cannot be updated, keeping the old photo", async () => {
    await service.set(USER, 1, JPEG);
    store.failWrites();
    await expect(service.set(USER, 1, JPEG)).rejects.toThrow("UPDATE が失敗した");
    expect(files.names()).toEqual(["photo-1.jpg"]);
  });

  it("removes the new file when the achievement vanished while saving", async () => {
    store.vanishAfterWrite();
    await expect(service.set(USER, 1, JPEG)).rejects.toThrow("が見つからない");
    expect(files.names()).toEqual([]);
  });

  it("removes the photo and its file", async () => {
    await service.set(USER, 1, JPEG);
    await service.remove(USER, 1);
    expect(files.names()).toEqual([]);
    expect(await store.find(1)).toMatchObject({ photoFilename: null, achievement: { photoUrl: null } });
  });

  it("does nothing when there is no photo to remove", async () => {
    await expect(service.remove(USER, 1)).resolves.toBeUndefined();
  });

  it("answers NOT_FOUND when removing the photo of an achievement that does not exist", async () => {
    await expect(service.remove(USER, 2)).rejects.toThrow("が見つからない");
  });

  // 行はもう写真を指していないので API は成功のまま。ログとメトリクスに残す（api.md §5）
  it("still succeeds when the file cannot be removed, and counts it", async () => {
    await service.set(USER, 1, JPEG);
    files.failRemoving();
    await service.remove(USER, 1);
    expect(logger.errors()).toHaveLength(1);
    expect(await metrics.render()).toContain("orphan_file_errors_total 1");
  });
});

describe("PhotoFormat", () => {
  const format = new PhotoFormat();

  it.each([
    ["jpg", [0xff, 0xd8, 0xff, 0xe1]],
    ["png", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]],
    ["webp", [...Buffer.from("RIFF"), 1, 2, 3, 4, ...Buffer.from("WEBPVP8 ")]],
  ])("detects %s from the first bytes", (extension, bytes) => {
    expect(format.extension(Buffer.from(bytes))).toBe(extension);
  });

  it.each([
    ["an empty file", []],
    ["SVG", [...Buffer.from("<svg")]],
    ["a RIFF file that is not WebP", [...Buffer.from("RIFF"), 1, 2, 3, 4, ...Buffer.from("WAVE")]],
    ["a cut PNG header", [0x89, 0x50, 0x4e]],
  ])("rejects %s", (_name, bytes) => {
    expect(format.extension(Buffer.from(bytes))).toBeNull();
  });
});
