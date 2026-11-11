import { describe, expect, it } from "vitest";
import { PgConnectionParser, PgDump } from "../../src/infra/PgDump";
import type { DumpProgram } from "../../src/infra/PgDump";
import { BackupEntry } from "../../src/jobs/BackupEntry";
import { BackupJob } from "../../src/jobs/BackupJob";
import { FakeBackupFiles } from "../fakes/FakeBackupFiles";
import { FakeLogger } from "../fakes/FakeLogger";
import { FixedClock } from "../fakes/FakeOptionStore";

// 週 1 の書き出し（data.md §6）。pg_dump の代わりに node を起動し、出力と終了コードで成功・失敗を確かめる
// （手元・CI の pg_dump は版が DB と合うとは限らないので、本物の pg_dump はイメージのスモークテストで版だけ見る）
const SOCKET_URL = "postgres://ol_migrator_production:p%40ss@/optionlist_production?host=/cloudsql/proj:asia-northeast1:takkelab-pg&sslmode=disable";
const EVAL = ["--input-type=module", "--eval"];
const PRINTS_ENV: DumpProgram = {
  command: process.execPath,
  args: [...EVAL, "process.stdout.write(['PGHOST', 'PGUSER', 'PGPASSWORD', 'PGDATABASE', 'PGSSLMODE'].map((k) => String(process.env[k])).join('|')); process.exit(0)"],
};
const FAILS_HALFWAY: DumpProgram = { command: process.execPath, args: [...EVAL, "process.stdout.write('partial'); process.stderr.write('permission denied'); process.exit(1)"] };
const PRINTS_NOTHING: DumpProgram = { command: process.execPath, args: [...EVAL, "process.exit(0)"] };
const fixedClock = new FixedClock("2026-11-15T20:00:00.123Z");

describe("PgConnectionParser", () => {
  it("reads the Unix socket URL used on Cloud Run", () => {
    expect(new PgConnectionParser().parse(SOCKET_URL)).toEqual({
      host: "/cloudsql/proj:asia-northeast1:takkelab-pg",
      port: "",
      user: "ol_migrator_production",
      password: "p@ss",
      database: "optionlist_production",
      sslmode: "disable",
    });
  });

  it("reads a host and port URL used locally", () => {
    const parsed = new PgConnectionParser().parse("postgresql://ol_migrator:secret@127.0.0.1:5432/optionlist");
    expect(parsed).toMatchObject({ host: "127.0.0.1", port: "5432", user: "ol_migrator", password: "secret", database: "optionlist", sslmode: "" });
  });

  it("rejects something that is not a postgres URL", () => {
    expect(() => new PgConnectionParser().parse("mysql://root@localhost/db")).toThrow("DATABASE_URL の形が違う");
  });
});

describe("BackupJob", () => {
  const connection = new PgConnectionParser().parse(SOCKET_URL);

  it("writes the dump under <database>/<UTC time>.dump and logs its size", async () => {
    const files = new FakeBackupFiles();
    const log = new FakeLogger();
    const name = await new BackupJob({ source: new PgDump(connection, PRINTS_ENV), files, clock: fixedClock, log }).run();
    expect(name).toBe("optionlist_production/2026-11-15T20-00-00Z.dump");
    // 接続先は環境変数で渡る（コマンドラインにパスワードを出さない）
    expect(files.read(name)).toBe("/cloudsql/proj:asia-northeast1:takkelab-pg|ol_migrator_production|p@ss|optionlist_production|disable");
    const [entry] = log.infos();
    expect(entry?.kind).toBe("backup_result");
    expect(entry?.counts).toEqual({ bytes: (files.read(name) ?? "").length });
    expect(entry?.message).not.toContain("p@ss");
  });

  it("fails without keeping a partial file when pg_dump exits with an error", async () => {
    const files = new FakeBackupFiles();
    const job = new BackupJob({ source: new PgDump(connection, FAILS_HALFWAY), files, clock: fixedClock, log: new FakeLogger() });
    await expect(job.run()).rejects.toThrow(/終了コード 1.*permission denied/);
    expect(files.names()).toEqual([]);
  });

  it("fails when the dump is empty", async () => {
    const job = new BackupJob({ source: new PgDump(connection, PRINTS_NOTHING), files: new FakeBackupFiles(), clock: fixedClock, log: new FakeLogger() });
    await expect(job.run()).rejects.toThrow("書き出しが空だった");
  });

  it("fails when pg_dump cannot be started", async () => {
    const job = new BackupJob({ source: new PgDump(connection, { command: "optionlist-no-such-pg-dump", args: [] }), files: new FakeBackupFiles(), clock: fixedClock, log: new FakeLogger() });
    await expect(job.run()).rejects.toThrow();
  });
});

describe("BackupEntry", () => {
  const env = { DATABASE_URL: SOCKET_URL, BACKUP_BUCKET: "optionlist-backups" };

  it("returns 0 and logs backup_result when the dump is written", async () => {
    const files = new FakeBackupFiles();
    const log = new FakeLogger();
    expect(await new BackupEntry(env, log, { files, program: PRINTS_ENV }).run()).toBe(0);
    expect(log.infos().map((entry) => entry.kind)).toEqual(["backup_result"]);
    expect(files.names()).toHaveLength(1);
  });

  it("returns 1, logs backup_failed and keeps no file when pg_dump fails", async () => {
    const log = new FakeLogger();
    const files = new FakeBackupFiles();
    expect(await new BackupEntry(env, log, { files, program: FAILS_HALFWAY }).run()).toBe(1);
    expect(log.entries().map((entry) => entry.kind)).toEqual(["backup_failed"]);
    expect(files.names()).toEqual([]);
  });

  // URL に sslmode がなければ PGSSLMODE を渡さない（空のまま渡すと libpq が止まる）
  it("does not pass empty connection values to pg_dump", async () => {
    const files = new FakeBackupFiles();
    const local = { ...env, DATABASE_URL: "postgres://ol_migrator:secret@/optionlist?host=/tmp" };
    const { PGSSLMODE: _inherited, PGPORT: _port, ...clean } = process.env;
    expect(await new BackupEntry({ ...clean, ...local }, new FakeLogger(), { files, program: PRINTS_ENV }).run()).toBe(0);
    const [name = ""] = files.names();
    expect(files.read(name)).toBe("/tmp|ol_migrator|secret|optionlist|undefined");
  });

  it.each([
    ["DATABASE_URL", { BACKUP_BUCKET: "optionlist-backups" }],
    ["BACKUP_BUCKET", { DATABASE_URL: SOCKET_URL }],
  ])("returns 1 and logs backup_failed without %s", async (_name, partial) => {
    const log = new FakeLogger();
    expect(await new BackupEntry(partial, log, { program: PRINTS_ENV }).run()).toBe(1);
    expect(log.entries().map((entry) => entry.kind)).toEqual(["backup_failed"]);
  });
});
