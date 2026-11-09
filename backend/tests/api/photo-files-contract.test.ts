import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Storage } from "@google-cloud/storage";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Achievement } from "../../../shared/types";
import { PgDatabase } from "../../src/infra/PgDatabase";
import { PgPoolFactory } from "../../src/infra/PgPoolFactory";
import { PromMetrics } from "../../src/metrics/PromMetrics";
import { GcsPhotoFiles } from "../../src/repositories/GcsPhotoFiles";
import { LocalPhotoFiles } from "../../src/repositories/LocalPhotoFiles";
import type { PhotoFiles } from "../../src/repositories/PhotoFiles";
import { OptionsApiClient } from "../fakes/OptionsApiClient";
import { TestApp } from "../fakes/TestApp";
import { TestDatabase } from "../fakes/TestDatabase";
import { TestImages } from "../fakes/TestImages";
import { TestUsers } from "../fakes/TestUsers";

// PhotoFiles の 2 つの実装（手元・CI の LocalPhotoFiles、確認用・本番の GcsPhotoFiles）を同じテストで確かめる（testing.md §2）
// GcsPhotoFiles は fake-gcs-server（npm --prefix backend run gcs:emulator）につなぐ。GCS_EMULATOR_URL がなければ
// 手元では飛ばし、CI では失敗にする（CI で黙って飛ばさない。docs/decisions/0051）
// エミュレーターは apiEndpoint で渡す（STORAGE_EMULATOR_HOST はライブラリがそのまま JSON API の基点にし、/storage/v1 が付かない）
const emulator = process.env.GCS_EMULATOR_URL ?? "";
const inCi = (process.env.CI ?? "") !== "";
const BUCKET = "optionlist-test-photos";
const uploadDir = mkdtempSync(join(tmpdir(), "optionlist-contract-"));
const storage = new Storage({ projectId: "optionlist-test", apiEndpoint: emulator === "" ? "http://127.0.0.1:1" : emulator });
const bucket = storage.bucket(BUCKET);
const JPEG = await new TestImages().jpeg();

const implementations: [string, PhotoFiles][] = [["LocalPhotoFiles", new LocalPhotoFiles(uploadDir)]];
if (emulator !== "" || inCi) implementations.push(["GcsPhotoFiles", new GcsPhotoFiles(bucket)]);

beforeAll(async () => {
  if (emulator === "" && inCi) throw new Error("CI では GCS_EMULATOR_URL（fake-gcs-server）が必要です");
  if (emulator === "") return;
  const [exists] = await bucket.exists();
  if (!exists) await storage.createBucket(BUCKET);
});

afterAll(() => {
  rmSync(uploadDir, { recursive: true, force: true });
});

describe.each(implementations)("%s", (_name, files) => {
  it("saves under a server-chosen name and reads the same bytes back", async () => {
    const name = await files.save(JPEG);
    expect(name).toMatch(/^[0-9a-f-]{36}\.jpg$/);
    expect(await files.read(name)).toEqual(JPEG);
  });

  it("gives a new name every time", async () => {
    expect(await files.save(JPEG)).not.toBe(await files.save(JPEG));
  });

  it("reads nothing after removing the file", async () => {
    const name = await files.save(JPEG);
    await files.remove(name);
    expect(await files.read(name)).toBeNull();
  });

  it("reads null for a name that does not exist, and removing it does not fail", async () => {
    expect(await files.read("00000000-0000-0000-0000-000000000000.jpg")).toBeNull();
    await expect(files.remove("00000000-0000-0000-0000-000000000000.jpg")).resolves.toBeUndefined();
  });
});

// API 越しに、Cloud Storage に保存して配信できる（入れ物のファイルは image/jpeg）
describe.skipIf(emulator === "" && !inCi)("the photo API with GcsPhotoFiles", () => {
  const pool = new PgPoolFactory(process.env, console, "DATABASE_URL").create();
  const appPool = new PgPoolFactory(process.env, console, "APP_DATABASE_URL").create();
  const app = new TestApp({ db: new PgDatabase(appPool, new PromMetrics()), photoFiles: new GcsPhotoFiles(bucket) }).build();
  const api = new OptionsApiClient(app);

  beforeAll(async () => {
    await new TestDatabase(pool).reset();
    const { cookie } = await new TestUsers(pool).create();
    api.use(cookie);
  });

  afterAll(async () => {
    await new TestDatabase(pool).reset();
    await Promise.all([pool.end(), appPool.end()]);
  });

  it("saves the photo to the bucket and serves it", async () => {
    const { id } = await api.added("a");
    const { body: achieved } = await api.achieve(id);
    const { body } = await api.upload(`/api/achievements/${(achieved as Achievement).id}/photo`, JPEG, "a.jpg");
    const { photoUrl } = body as Achievement;
    const name = String(photoUrl).replace("/api/photos/", "");
    const file = bucket.file(name);
    const [metadata] = await file.getMetadata();
    expect(metadata.contentType).toBe("image/jpeg");
    const { status, headers } = await api.send((r) => r.get(String(photoUrl)));
    expect([status, headers["content-type"]]).toEqual([200, "image/jpeg"]);
  });
});
