import { beforeEach, describe, expect, it } from "vitest";
import { PromMetrics } from "../../src/metrics/PromMetrics";
import { AchievementPhotoService } from "../../src/services/AchievementPhotoService";
import type { PhotoQuota } from "../../src/services/AchievementPhotoService";
import { AppError } from "../../src/services/errors";
import { PhotoCleanup } from "../../src/services/PhotoCleanup";
import { PhotoFormat } from "../../src/services/PhotoFormat";
import { FakeAchievementStore } from "../fakes/FakeAchievementStore";
import { FakeLogger } from "../fakes/FakeLogger";
import { FakePhotoFiles } from "../fakes/FakePhotoFiles";
import { FakePhotoRebuilder } from "../fakes/FakePhotoRebuilder";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const USER = 7;
const NOW = new Date("2026-11-06T00:00:00.000Z");

describe("AchievementPhotoService", () => {
  let store: FakeAchievementStore;
  let files: FakePhotoFiles;
  let metrics: PromMetrics;
  let logger: FakeLogger;
  let service: AchievementPhotoService;
  const rebuilder = new FakePhotoRebuilder(100);
  // 作り直した写真は 100 バイト
  const build = (quota: PhotoQuota = { maxCount: 10, maxBytes: 1_000 }): AchievementPhotoService =>
    new AchievementPhotoService({
      stores: store,
      files,
      cleanup: new PhotoCleanup(files, metrics, logger),
      format: new PhotoFormat(),
      rebuilder,
      quota,
    });

  beforeEach(async () => {
    store = new FakeAchievementStore([1]);
    await store.insert(1, NOW);
    files = new FakePhotoFiles();
    metrics = new PromMetrics();
    logger = new FakeLogger();
    service = build();
  });

  // 配信してよいのは、その人の達成の写真だけ。アカウントがない人には store に聞かずに配らない（api.md §5）
  it("serves only the photo of the person's own achievement", async () => {
    await service.set(USER, 1, JPEG);
    expect(await service.open(USER, "photo-1.jpg")).toEqual({ bytes: Buffer.alloc(100, 1), contentType: "image/jpeg" });
    expect(await service.open(USER, "photo-9.jpg")).toBeNull();
    const asked = store.users().length;
    expect(await service.open(null, "photo-1.jpg")).toBeNull();
    expect(store.users()).toHaveLength(asked);
  });

  // 行はあるのにファイルがない（消し損ねの逆。data.md §6）
  it("serves nothing when the row points to a missing file", async () => {
    await service.set(USER, 1, JPEG);
    await files.remove("photo-1.jpg");
    expect(await service.open(USER, "photo-1.jpg")).toBeNull();
  });

  // 保存するのは作り直したものだけ（api.md §5）
  it("saves the rebuilt photo and returns the achievement with its URL", async () => {
    expect(await service.set(USER, 1, JPEG)).toMatchObject({ id: 1, photoUrl: "/api/photos/photo-1.jpg" });
    expect(files.names()).toEqual(["photo-1.jpg"]);
    expect(await files.read("photo-1.jpg")).toEqual(Buffer.alloc(100, 1));
  });

  it("writes no file for an image that cannot be rebuilt", async () => {
    await expect(service.set(USER, 1, rebuilder.unreadable(JPEG))).rejects.toThrow("画像として読めない");
    expect(files.names()).toEqual([]);
  });

  // 1 人あたりの上限（data.md §3）。数えるのは作り直した後の大きさ
  it.each([
    ["the count", { maxCount: 1, maxBytes: 1_000 }],
    ["the total size", { maxCount: 10, maxBytes: 150 }],
  ])("refuses a new photo over %s, writing no file", async (_name, quota) => {
    service = build(quota);
    await store.insert(1, NOW);
    await service.set(USER, 1, JPEG);
    const refused = service.set(USER, 2, JPEG);
    await expect(refused).rejects.toMatchObject({ message: "写真はこれ以上保存できない" });
    await expect(refused).rejects.toSatisfy((error: unknown) => error instanceof AppError && error.code() === "PHOTO_LIMIT_REACHED");
    expect(files.names()).toEqual(["photo-1.jpg"]);
  });

  // 置き換える写真は数えない（上限ちょうどでも付け替えられる）
  it("replaces a photo at the limit", async () => {
    service = build({ maxCount: 1, maxBytes: 100 });
    await service.set(USER, 1, JPEG);
    expect(await service.set(USER, 1, JPEG)).toMatchObject({ photoUrl: "/api/photos/photo-2.jpg" });
  });

  // 形式は達成より先に確かめる（ない達成でも、写真でなければ 400。api.md §5）
  it("checks the format before the achievement", async () => {
    await expect(service.set(USER, 2, Buffer.from("<svg></svg>"))).rejects.toThrow("JPEG");
  });

  it("checks the achievement before rebuilding", async () => {
    await expect(service.set(USER, 2, rebuilder.unreadable(JPEG))).rejects.toThrow("が見つからない");
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
