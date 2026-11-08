import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Achievement, Option } from "../../../shared/types";
import { LocalPhotoFiles } from "../../src/repositories/LocalPhotoFiles";
import { PgDatabase } from "../../src/infra/PgDatabase";
import { PgPoolFactory } from "../../src/infra/PgPoolFactory";
import { PromMetrics } from "../../src/metrics/PromMetrics";
import { FakePhotoFiles } from "../fakes/FakePhotoFiles";
import { OptionsApiClient } from "../fakes/OptionsApiClient";
import { TestApp } from "../fakes/TestApp";
import { TestDatabase } from "../fakes/TestDatabase";

// 達成の写真（api.md §2・§5、testing.md §2）。保存先はテストごとの一時フォルダ
const pool = new PgPoolFactory(process.env).create();
const data = new TestDatabase(pool);
const dbWrapper = new PgDatabase(pool, new PromMetrics());
const uploadDir = mkdtempSync(join(tmpdir(), "optionlist-photos-"));
const app: Express = new TestApp({ db: dbWrapper, photoFiles: new LocalPhotoFiles(uploadDir) }).build();
const api = new OptionsApiClient(app);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100)]);

beforeEach(async () => {
  await data.reset();
  rmSync(uploadDir, { recursive: true, force: true });
});

afterAll(async () => {
  await data.reset();
  await pool.end();
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
    const pending = request(app).put(`/api/achievements/${id}/photo`);
    const { status, body } = await pending.attach("photo", bytes, filename);
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

    const { status: servedStatus, type, headers } = await request(app).get(String(photoUrl));
    expect(servedStatus).toBe(200);
    expect(type).toBe("image/jpeg");
    expect(headers["cache-control"]).toContain("immutable");
    expect(headers["x-content-type-options"]).toBe("nosniff");

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

  // いちばん新しい達成に写真がなければ、写真がある中でいちばん新しいものを出す（screens.md §6）
  it("uses the newest achievement that has a photo for the option", async () => {
    const { id: optionId } = await api.added("a");
    await pool.query(
      `INSERT INTO achievements (id, option_id, achieved_at, photo_filename) OVERRIDING SYSTEM VALUE VALUES
       (1, $1, '2026-11-01 00:00:00', 'old.jpg'), (2, $1, '2026-11-02 00:00:00', 'new.jpg'), (3, $1, '2026-11-03 00:00:00', NULL)`,
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
    const pending = request(app).put(`/api/achievements/${id}/photo`);
    const withField = pending.field("note", "x");
    const { status, body } = await withField.attach("photo", JPEG, "photo.jpg");
    expect(status).toBe(400);
    expect(body).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
    expect(folder.files()).toEqual([]);
  });

  it("returns 400 when no photo is sent", async () => {
    const { id } = await steps.achieved();
    const { status } = await request(app).put(`/api/achievements/${id}/photo`).send({});
    expect(status).toBe(400);
  });

  it.each(["999", "abc", "0"])("returns 404 for the achievement %s", async (id) => {
    const { status, body } = await steps.put(id, JPEG);
    expect(status).toBe(404);
    expect(body).toMatchObject({ error: { code: "NOT_FOUND" } });
    expect(folder.files()).toEqual([]);
  });
});

describe("DELETE /api/achievements/:id/photo", () => {
  it("removes the photo and its file", async () => {
    const achievement = await steps.achieved();
    await steps.put(achievement.id, JPEG);
    const { status } = await request(app).delete(`/api/achievements/${achievement.id}/photo`);
    expect(status).toBe(204);
    expect(folder.files()).toEqual([]);
    const detail = await api.detail(achievement.optionId);
    expect(detail.body).toMatchObject({ latestPhotoUrl: null, achievements: [{ photoUrl: null }] });
  });

  it("returns 204 when there is no photo", async () => {
    const { id } = await steps.achieved();
    const { status } = await request(app).delete(`/api/achievements/${id}/photo`);
    expect(status).toBe(204);
  });

  it("returns 404 for an achievement that does not exist", async () => {
    const { status } = await request(app).delete("/api/achievements/999/photo");
    expect(status).toBe(404);
  });
});

describe("GET /api/photos", () => {
  it("returns the JSON 404 for a file that does not exist", async () => {
    const { status, body } = await request(app).get("/api/photos/nothing.jpg");
    expect(status).toBe(404);
    expect(body).toMatchObject({ error: { code: "NOT_FOUND" } });
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
    const client = new OptionsApiClient(failing);
    const { id } = await client.added("a");
    const { body } = await client.achieve(id);
    const upload = request(failing).put(`/api/achievements/${(body as Achievement).id}/photo`);
    await upload.attach("photo", JPEG, "photo.jpg");
    files.failRemoving();

    expect(await client.remove(id)).toMatchObject({ status: 204 });
    const { text } = await request(failing).get("/api/metrics");
    expect(text).toContain("orphan_file_errors_total 1");
  });
});
