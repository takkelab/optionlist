import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { SharpPhotoRebuilder } from "../../src/services/PhotoRebuilder";
import { TestImages } from "../fakes/TestImages";

// 受け取った写真の作り直し（api.md §5、docs/decisions/0037）
const rebuilder = new SharpPhotoRebuilder();
const images = new TestImages();

describe("SharpPhotoRebuilder", () => {
  // 撮った場所などのメタデータを預からない（testing.md §2）
  it("removes the EXIF, including the location", async () => {
    const original = await images.jpegWithLocation();
    const { exif } = await sharp(original).metadata();
    expect(exif).toBeDefined();
    const rebuilt = await rebuilder.rebuild(original);
    expect(rebuilt).not.toBeNull();
    const metadata = await sharp(rebuilt ?? Buffer.alloc(0)).metadata();
    expect([metadata.format, metadata.exif, metadata.icc, metadata.xmp]).toEqual(["jpeg", undefined, undefined, undefined]);
  });

  it("shrinks the long side to 1280px", async () => {
    const rebuilt = await rebuilder.rebuild(await images.png(2000, 1000));
    const { width, height, format } = await sharp(rebuilt ?? Buffer.alloc(0)).metadata();
    expect({ width, height, format }).toEqual({ width: 1280, height: 640, format: "jpeg" });
  });

  it("does not enlarge a small photo", async () => {
    const rebuilt = await rebuilder.rebuild(await images.jpeg(40, 30));
    const { width, height } = await sharp(rebuilt ?? Buffer.alloc(0)).metadata();
    expect({ width, height }).toEqual({ width: 40, height: 30 });
  });

  // 向きは画素に焼き込む（メタデータを消すと Orientation もなくなるため）
  it("applies the orientation before removing it", async () => {
    const rebuilt = await rebuilder.rebuild(await images.rotatedJpeg());
    const { width, height, orientation } = await sharp(rebuilt ?? Buffer.alloc(0)).metadata();
    expect({ width, height, orientation }).toEqual({ width: 20, height: 40, orientation: undefined });
  });

  // 解凍爆弾（docs/decisions/0051）。上限は小さくして確かめる（本番は 5,000 万画素）
  it("does not read an image over the pixel limit", async () => {
    const limited = new SharpPhotoRebuilder(40 * 30);
    expect(await limited.rebuild(await images.jpeg(40, 30))).not.toBeNull();
    expect(await limited.rebuild(await images.jpeg(41, 30))).toBeNull();
  });

  it.each([
    ["only a JPEG header", Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])],
    ["text", Buffer.from("<svg></svg>")],
  ])("returns null for %s", async (_name, bytes) => {
    expect(await rebuilder.rebuild(bytes)).toBeNull();
  });
});
