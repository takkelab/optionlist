import type { Pool } from "pg";
import { PgDatabase } from "../../src/infra/PgDatabase";
import type { CleanupCounts } from "../../src/jobs/CleanupJob";
import { CleanupJob } from "../../src/jobs/CleanupJob";
import { CleanupRepository } from "../../src/jobs/CleanupRepository";
import type { LogEntry } from "../../src/middleware/Middleware";
import { PromMetrics } from "../../src/metrics/PromMetrics";
import { PhotoCleanup } from "../../src/services/PhotoCleanup";
import { FakeLogger } from "./FakeLogger";
import { FixedClock } from "./FakeOptionStore";
import { FakePhotoFiles } from "./FakePhotoFiles";

export interface CleanupJobDriver {
  savePhoto(text: string): Promise<string>;
  advance(ms: number): void;
  failRemoving(): void;
  run(): Promise<CleanupCounts>;
  photoNames(): string[];
  infos(): LogEntry[];
  errorKinds(): string[];
}

// 削除のジョブを、本物の DB（ol_cleanup のプール）とフェイクの時計・写真の置き場所・ログで動かす
// 写真は時計の今の時刻で置く。advance で時計を進めてから run する
export class CleanupHarness implements CleanupJobDriver {
  readonly #pool: Pool;
  readonly #clock: FixedClock;
  readonly #files: FakePhotoFiles;
  readonly #log = new FakeLogger();

  constructor(cleanupPool: Pool, clockAt: string) {
    this.#pool = cleanupPool;
    this.#clock = new FixedClock(clockAt);
    this.#files = new FakePhotoFiles(this.#clock);
  }

  savePhoto(text: string): Promise<string> {
    return this.#files.save(Buffer.from(text));
  }

  advance(ms: number): void {
    this.#clock.advance(ms);
  }

  failRemoving(): void {
    this.#files.failRemoving();
  }

  run(): Promise<CleanupCounts> {
    return new CleanupJob({
      store: new CleanupRepository(new PgDatabase(this.#pool, new PromMetrics())),
      files: this.#files,
      photos: new PhotoCleanup(this.#files, new PromMetrics(), this.#log),
      clock: this.#clock,
      log: this.#log,
    }).run();
  }

  photoNames(): string[] {
    return this.#files.names();
  }

  infos(): LogEntry[] {
    return this.#log.infos();
  }

  errorKinds(): string[] {
    return this.#log.entries().map((entry) => entry.kind);
  }
}
