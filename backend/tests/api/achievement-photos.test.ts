import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Express } from "express";
import sharp from "sharp";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Achievement, Option } from "../../../shared/types";
import { LocalPhotoFiles } from "../../src/repositories/LocalPhotoFiles";
import { PgDatabase } from "../../src/infra/PgDatabase";
import { PgPoolFactory } from "../../src/infra/PgPoolFactory";
import { PromMetrics } from "../../src/metrics/PromMetrics";
import { FakePhotoFiles } from "../fakes/FakePhotoFiles";
import { OptionsApiClient } from "../fakes/OptionsApiClient";
import { TestApp } from "../fakes/TestApp";
import { TestImages } from "../fakes/TestImages";
import { TestRequests } from "../fakes/TestRequests";
import { TestDatabase } from "../fakes/TestDatabase";
import { TestUsers } from "../fakes/TestUsers";

// 達成の写真（api.md §2・§5、testing.md §2）。保存先はテストごとの一時フォルダ
// 前提の行は ol_migrator（pool）で入れ、アプリは ol_app（appPool）で動かす（testing.md §0）
const pool = new PgPoolFactory(process.env, console, "DATABASE_URL").create();
const appPool = new PgPoolFactory(process.env, console, "APP_DATABASE_URL").create();
const data = new TestDatabase(pool);
const users = new TestUsers(pool);
const dbWrapper = new PgDatabase(appPool, new PromMetrics());
const uploadDir = mkdtempSync(join(tmpdir(), "optionlist-photos-"));
const app: Express = new TestApp({ db: dbWrapper, photoFiles: new LocalPhotoFiles(uploadDir) }).build();
const images = new TestImages();
const JPEG = await images.jpeg();
// 各テストの人（reset で ID が 1 から振り直されるので、直接入れる行の user_id は 1）。beforeEach で Cookie を入れる
const api = new OptionsApiClient(app);

beforeEach(async () => {
  await data.reset();
  rmSync(uploadDir, { recursive: true, force: true });
  const { cookie } = await users.create();
  api.use(cookie);
});

afterAll(async () => {
  await data.reset();
  await Promise.all([pool.end(), appPool.end()]);
  rmSync(uploadDir, { recursive: true, force: true });
});

interface Stored {
  files(): string[];
}

class UploadFolder implements Stored {
  files(): string[] {
    return existsSync(uploadDir) ? readdirSync(uploadDir) : [];
  }
}

const folder = new UploadFolder();

interface PhotoSteps {
  achieved(): Promise<Achievement>;
  put(id: number | string, bytes: Buffer, filename?: string): Promise<{ status: number; body: unknown }>;
}

class Steps implements PhotoSteps {
  async achieved(): Promise<Achievement> {
    const { id } = await api.added("a");
    const { body } = await api.achieve(id);
    return body as Achievement;
  }

  async put(id: number | string, bytes: Buffer, filename = "photo.jpg"): Promise<{ status: number; body: unknown }> {
    const { status, body } = await api.upload(`/api/achievements/${id}/photo`, bytes, filename);
    return { status, body };
  }
}

const steps = new Steps();

describe("PUT /api/achievements/:id/photo", () => {
  it("saves the photo, serves it, and shows it on the achievement and the option", async () => {
    const achievement = await steps.achieved();
    const { status, body } = await steps.put(achievement.id, JPEG);
    expect(status).toBe(200);
    const { photoUrl } = body as Achievement;
    expect(photoUrl).toMatch(/^\/api\/photos\/[0-9a-f-]{36}\.jpg$/);

    const { status: servedStatus, headers } = await api.send((r) => r.get(String(photoUrl)));
    expect(servedStatus).toBe(200);
    // 人ごとに違う中身なので、共有のキャッシュに置かせない。写真に見せかけた HTML などを実行させない（api.md §5）
    expect(headers).toMatchObject({
      "content-type": "image/jpeg",
      "cache-control": "private, max-age=31536000, immutable",
      vary: "Cookie",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'",
      "content-disposition": "inline",
    });

    const detail = await api.detail(achievement.optionId);
    expect(detail.body).toMatchObject({ latestPhotoUrl: photoUrl, achievements: [{ id: achievement.id, photoUrl }] });
  });

  it("replaces the photo and removes the old file", async () => {
    const { id } = await steps.achieved();
    await steps.put(id, JPEG);
    const [first] = folder.files();
    await steps.put(id, JPEG);
    const after = folder.files();
    expect(after).toHaveLength(1);
    expect(after).not.toContain(first);
  });

  // 同時に置き換えても、行が指すファイル 1 つだけが残る（行を押さえてから前の名前を読む）
  it("leaves only the file the row points to when two replacements race", async () => {
    const { id } = await steps.achieved();
    await steps.put(id, JPEG);
    await Promise.all([steps.put(id, JPEG), steps.put(id, JPEG), steps.put(id, JPEG)]);
    const { rows } = await pool.query("SELECT photo_filename FROM achievements");
    expect(folder.files()).toEqual(rows.map((row: { photo_filename: string }) => row.photo_filename));
  });

  // いちばん新しい達成に写真がなければ、写真がある中でいちばん新しいものを出す（screens.md §6）
  it("uses the newest achievement that has a photo for the option", async () => {
    const { id: optionId } = await api.added("a");
    await pool.query(
      `INSERT INTO achievements (id, user_id, option_id, achieved_at, photo_filename, photo_bytes) OVERRIDING SYSTEM VALUE VALUES
       (1, 1, $1, '2026-11-01 00:00:00', 'old.jpg', 1), (2, 1, $1, '2026-11-02 00:00:00', 'new.jpg', 1), (3, 1, $1, '2026-11-03 00:00:00', NULL, NULL)`,
      [optionId],
    );
    const { body } = await api.list("?status=pending");
    expect((body as Option[])[0]).toMatchObject({ latestPhotoUrl: "/api/photos/new.jpg" });
  });

  it("ignores the name and type the client claims", async () => {
    const { id } = await steps.achieved();
    const { body } = await steps.put(id, JPEG, "../../evil.png");
    expect((body as Achievement).photoUrl).toMatch(/^\/api\/photos\/[0-9a-f-]{36}\.jpg$/);
    expect(folder.files()).toHaveLength(1);
  });

  it("returns 400 for a file that is not a photo", async () => {
    const { id } = await steps.achieved();
    const { status, body } = await steps.put(id, Buffer.from("<svg></svg>"), "photo.jpg");
    expect(status).toBe(400);
    expect(body).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
    expect(folder.files()).toEqual([]);
  });

  it("returns 400 for a file over 5MB", async () => {
    const { id } = await steps.achieved();
    const { status, body } = await steps.put(id, Buffer.concat([JPEG, Buffer.alloc(5 * 1024 * 1024)]));
    expect(status).toBe(400);
    expect(body).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
    expect(folder.files()).toEqual([]);
  });

  it("returns 400 when the form has anything other than the photo", async () => {
    const { id } = await steps.achieved();
    const { status, body } = await api.send((r) => {
      const pending = r.put(`/api/achievements/${id}/photo`);
      const withField = pending.field("note", "x");
      return withField.attach("photo", JPEG, "photo.jpg");
    });
    expect(status).toBe(400);
    expect(body).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
    expect(folder.files()).toEqual([]);
  });

  it("returns 400 when no photo is sent", async () => {
    const { id } = await steps.achieved();
    const { status } = await api.send((r) => r.put(`/api/achievements/${id}/photo`).send({}));
    expect(status).toBe(400);
  });

  it.each(["999", "abc", "0"])("returns 404 for the achievement %s", async (id) => {
    const { status, body } = await steps.put(id, JPEG);
    expect(status).toBe(404);
    expect(body).toMatchObject({ error: { code: "NOT_FOUND" } });
    expect(folder.files()).toEqual([]);
  });
});

// sharp で作り直したものだけを保存する（api.md §5、docs/decisions/0037）
describe("PUT /api/achievements/:id/photo rebuilds the photo", () => {
  it("removes the location from the saved file and records its size", async () => {
    const { id } = await steps.achieved();
    expect(await steps.put(id, await images.jpegWithLocation())).toMatchObject({ status: 200 });
    const [name] = folder.files();
    const saved = readFileSync(join(uploadDir, String(name)));
    const { exif, format } = await sharp(saved).metadata();
    expect([format, exif]).toEqual(["jpeg", undefined]);
    const { rows } = await pool.query("SELECT photo_filename, photo_bytes FROM achievements");
    expect(rows).toEqual([{ photo_filename: name, photo_bytes: saved.length }]);
  });

  it("shrinks a PNG into a JPEG with the long side at 1280px", async () => {
    const { id } = await steps.achieved();
    const { body } = await steps.put(id, await images.png(2000, 1000), "photo.png");
    expect((body as Achievement).photoUrl).toMatch(/\.jpg$/);
    const [name] = folder.files();
    const { width, height } = await sharp(readFileSync(join(uploadDir, String(name)))).metadata();
    expect({ width, height }).toEqual({ width: 1280, height: 640 });
  });

  it("returns 400 for a file that only starts like a JPEG", async () => {
    const { id } = await steps.achieved();
    const { status, body } = await steps.put(id, Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100)]));
    expect([status, body]).toMatchObject([400, { error: { code: "VALIDATION_ERROR" } }]);
    expect(folder.files()).toEqual([]);
  });
});

// 1 人あたりの上限（data.md §3）。超えたら 429 PHOTO_LIMIT_REACHED（待っても解けないので Retry-After なし。api.md §3）
describe("PUT /api/achievements/:id/photo and the limit per person", () => {
  const limited = new OptionsApiClient(
    new TestApp({ db: dbWrapper, photoFiles: new LocalPhotoFiles(uploadDir), photoQuota: { maxCount: 1, maxBytes: 1024 * 1024 } }).build(),
  );

  it("refuses a second photo, but still replaces the first one", async () => {
    limited.use(api.cookie());
    const first = await steps.achieved();
    const second = await steps.achieved();
    await limited.upload(`/api/achievements/${first.id}/photo`, JPEG, "a.jpg");
    const { status, body, headers } = await limited.upload(`/api/achievements/${second.id}/photo`, JPEG, "b.jpg");
    expect([status, body, headers["retry-after"]]).toMatchObject([429, { error: { code: "PHOTO_LIMIT_REACHED" } }, undefined]);
    expect(folder.files()).toHaveLength(1);
    expect(await limited.upload(`/api/achievements/${first.id}/photo`, JPEG, "c.jpg")).toMatchObject({ status: 200 });
  });
});

describe("DELETE /api/achievements/:id/photo", () => {
  it("removes the photo and its file", async () => {
    const achievement = await steps.achieved();
    await steps.put(achievement.id, JPEG);
    const { status } = await api.send((r) => r.delete(`/api/achievements/${achievement.id}/photo`));
    expect(status).toBe(204);
    expect(folder.files()).toEqual([]);
    const detail = await api.detail(achievement.optionId);
    expect(detail.body).toMatchObject({ latestPhotoUrl: null, achievements: [{ photoUrl: null }] });
  });

  it("returns 204 when there is no photo", async () => {
    const { id } = await steps.achieved();
    const { status } = await api.send((r) => r.delete(`/api/achievements/${id}/photo`));
    expect(status).toBe(204);
  });

  it("returns 404 for an achievement that does not exist", async () => {
    const { status } = await api.send((r) => r.delete("/api/achievements/999/photo"));
    expect(status).toBe(404);
  });
});

describe("GET /api/photos", () => {
  it("returns the JSON 404 for a file that does not exist", async () => {
    const { status, body } = await api.send((r) => r.get("/api/photos/nothing.jpg"));
    expect(status).toBe(404);
    expect(body).toMatchObject({ error: { code: "NOT_FOUND" } });
  });

  // 名前の形が違うもの（パストラバーサルを含む）は DB に聞かずに 404
  it.each(["..%2F..%2Fpackage.json", "a.txt", "x.jpg.exe"])("returns 404 for the name %s", async (name) => {
    const { status } = await api.send((r) => r.get(`/api/photos/${name}`));
    expect(status).toBe(404);
  });

  // 行はあるのにファイルがない（消し損ねの逆）も 404
  it("returns 404 when the row points to a missing file", async () => {
    const { id: optionId } = await api.added("a");
    await pool.query("INSERT INTO achievements (user_id, option_id, achieved_at, photo_filename, photo_bytes) VALUES (1, $1, now(), 'gone.jpg', 1)", [optionId]);
    const { status, body } = await api.send((r) => r.get("/api/photos/gone.jpg"));
    expect([status, body]).toMatchObject([404, { error: { code: "NOT_FOUND" } }]);
  });
});

describe("DELETE /api/options/:id and the photos", () => {
  it("removes the photo files together with the option", async () => {
    const achievement = await steps.achieved();
    await steps.put(achievement.id, JPEG);
    expect(folder.files()).toHaveLength(1);
    expect(await api.remove(achievement.optionId)).toMatchObject({ status: 204 });
    expect(folder.files()).toEqual([]);
    const { rows } = await pool.query("SELECT COUNT(*) AS n FROM achievements");
    expect(rows).toEqual([{ n: 0 }]);
  });

  it("still deletes the option when the file cannot be removed, and counts it", async () => {
    const files = new FakePhotoFiles();
    const metrics = new PromMetrics();
    const failing = new TestApp({ db: dbWrapper, metrics, photoFiles: files }).build();
    const client = new OptionsApiClient(failing, api.cookie());
    const { id } = await client.added("a");
    const { body } = await client.achieve(id);
    const { id: achievementId } = body as Achievement;
    await client.upload(`/api/achievements/${achievementId}/photo`, JPEG, "photo.jpg");
    files.failRemoving();

    expect(await client.remove(id)).toMatchObject({ status: 204 });
    const { text } = await new TestRequests(failing).metrics();
    expect(text).toContain("orphan_file_errors_total 1");
  });
});
