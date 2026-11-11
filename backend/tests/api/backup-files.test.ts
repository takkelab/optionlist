import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { Storage } from "@google-cloud/storage";
import { beforeAll, describe, expect, it } from "vitest";
import { GcsBackupFiles } from "../../src/repositories/GcsBackupFiles";

// 書き出しの置き場所（data.md §6）を fake-gcs-server で確かめる。GCS_EMULATOR_URL がなければ手元では飛ばし、
// CI では失敗にする（photo-files-contract.test.ts と同じ。docs/decisions/0051）
const emulator = process.env.GCS_EMULATOR_URL ?? "";
const inCi = (process.env.CI ?? "") !== "";
const BUCKET = "optionlist-test-backups";
const storage = new Storage({ projectId: "optionlist-test", apiEndpoint: emulator === "" ? "http://127.0.0.1:1" : emulator });
const bucket = storage.bucket(BUCKET);
const files = new GcsBackupFiles(bucket);

beforeAll(async () => {
  if (emulator === "" && inCi) throw new Error("CI では GCS_EMULATOR_URL（fake-gcs-server）が必要です");
  if (emulator === "") return;
  const [exists] = await bucket.exists();
  if (!exists) await storage.createBucket(BUCKET);
});

describe.skipIf(emulator === "" && !inCi)("GcsBackupFiles", () => {
  it("writes the stream and returns its size", async () => {
    const name = `optionlist_test/${randomUUID()}.dump`;
    expect(await files.write(name, Readable.from([Buffer.from("PGDMP"), Buffer.from("-body")]))).toBe(10);
    const stored = bucket.file(name);
    const [contents] = await stored.download();
    expect(contents.toString()).toBe("PGDMP-body");
  });

  // objectCreator だけのサービスアカウントで、前の書き出しを上書きしない
  it("refuses to overwrite an existing file", async () => {
    const name = `optionlist_test/${randomUUID()}.dump`;
    await files.write(name, Readable.from([Buffer.from("first")]));
    await expect(files.write(name, Readable.from([Buffer.from("second")]))).rejects.toThrow();
    const stored = bucket.file(name);
    const [contents] = await stored.download();
    expect(contents.toString()).toBe("first");
  });

  // pg_dump が途中で失敗したら（PgDump が流れを壊す）、途中までのファイルを残さない
  it("leaves no file when the stream breaks", async () => {
    const name = `optionlist_test/${randomUUID()}.dump`;
    const broken = new Readable({ read() {} });
    broken.push(Buffer.from("partial"));
    setTimeout(() => broken.destroy(new Error("pg_dump が失敗した")), 50);
    await expect(files.write(name, broken)).rejects.toThrow("pg_dump が失敗した");
    const stored = bucket.file(name);
    const [exists] = await stored.exists();
    expect(exists).toBe(false);
  });
});
