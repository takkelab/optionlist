import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import type { RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Achievement, Option } from "../../../shared/types";
import { LocalPhotoFiles } from "../../src/repositories/LocalPhotoFiles";
import { MySqlDatabase } from "../../src/infra/MySqlDatabase";
import { MySqlPoolFactory } from "../../src/infra/MySqlPoolFactory";
import { PromMetrics } from "../../src/metrics/PromMetrics";
import { BackendProcess, NODE_FLAGS } from "../fakes/BackendProcess";
import { CountingDatabase } from "../fakes/CountingDatabase";
import { FullScanFinder } from "../fakes/FullScanFinder";
import { NearestRankPercentile, PerfProbe } from "../fakes/PerfProbe";
import type { TimedResponse } from "../fakes/PerfProbe";
import { PerfResults } from "../fakes/PerfResults";
import { TestApp } from "../fakes/TestApp";

// metrics.md §4。性能用データ（§1）は npm run test:perf が先に入れる（db:perf-data）
// 結果は coverage/perf/results.json に書き、目標値との比較と測り直しは metrics:check が行う
// ケースは上から順に流れる（vitest は 1 ファイル内のケースを順に実行する）
const RESULTS_PATH = "coverage/perf/results.json";
const RUNS = 100;
const MEMORY_RUNS = 1_000;
// 性能用データの先頭の option はリンクが上限（200 件）まで付いている（db/perf-data/PerfDataGenerator.ts）
const HEAVIEST_OPTION = 1;
// 「ひとりで」（いちばん多くの提案に付いたタグ）を持つ提案。関連の候補がいちばん多くなる
const HEAVIEST_SUGGESTION = 5;
const READ_PATHS = [
  "/api/options?status=pending",
  "/api/options?status=completed",
  `/api/options/${HEAVIEST_OPTION}`,
  "/api/suggestions",
  `/api/suggestions/${HEAVIEST_SUGGESTION}`,
];
// マスターデータの表は提案の一覧の API が全部読むので、フルテーブルスキャンに数えない（docs/decisions/0021）
const MASTER_TABLES = ["themes", "tags", "suggestions", "suggestion_tags"];

const PHOTO_RUNS = 20;
const PHOTO = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(1024 * 1024 - 4)]);
const uploadDir = mkdtempSync(join(tmpdir(), "optionlist-perf-photos-"));

const pool = new MySqlPoolFactory(process.env).create();
const db = new CountingDatabase(new MySqlDatabase(pool, new PromMetrics()));
const results = new PerfResults();
const percentile = new NearestRankPercentile();
const scanFinder = new FullScanFinder(MASTER_TABLES);
const servers: Server[] = [];
const probes: PerfProbe[] = [];

beforeAll(async () => {
  const server = await new TestApp({ db, photoFiles: new LocalPhotoFiles(uploadDir) }).listen(0);
  const { port } = server.address() as AddressInfo;
  servers.push(server);
  probes.push(new PerfProbe(`http://127.0.0.1:${port}`, db));
});

afterAll(async () => {
  results.write(RESULTS_PATH);
  rmSync(uploadDir, { recursive: true, force: true });
  await Promise.all(servers.map((s) => new Promise((resolve) => s.close(resolve))));
  await pool.end();
});

describe("backend performance with the metrics.md §1 data", () => {
  it("has the perf data loaded", async () => {
    const [rows] = await pool.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM options");
    expect(rows).toEqual([{ n: 1000 }]);
  });

  it("starts the backend with the same Node flags as npm run dev / start", () => {
    const { scripts } = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
    for (const name of ["dev", "start"]) {
      for (const flag of NODE_FLAGS) expect(scripts[name]).toContain(flag);
    }
  });

  // RSS はプロセス全体の値なので、本物の server.ts を別プロセスで起動して測る（テスト側の fetch や応答の解析の分を乗せない）
  it("measures the backend RSS over consecutive requests", async () => {
    const backend = new BackendProcess();
    const mb = (bytes: number): number => Math.round((bytes / 1024 / 1024) * 10) / 10;
    try {
      const baseUrl = await backend.start();
      for (const path of READ_PATHS) await fetch(`${baseUrl}${path}`);
      let rssMax = await backend.rssBytes();
      const rssStart = rssMax;
      for (let i = 0; i < MEMORY_RUNS; i++) {
        const res = await fetch(`${baseUrl}${READ_PATHS[i % READ_PATHS.length] ?? "/api/health"}`);
        expect(res.status).toBe(200);
        await res.arrayBuffer();
        rssMax = Math.max(rssMax, await backend.rssBytes());
      }
      results.record({ id: "rss-max", value: mb(rssMax), detail: `開始時 ${mb(rssStart)}MB（別プロセスの server.ts）` });
    } finally {
      backend.stop();
    }
  });

  // ヒープは GC してから比べたいので、--expose-gc で起動したこのワーカーの中で listen した backend で測る
  it("measures the heap growth over consecutive requests", async () => {
    const [probe] = probes;
    const { gc } = globalThis as typeof globalThis & { gc?: () => void };
    if (gc === undefined) throw new Error("--expose-gc で起動していない（vitest.perf.config.ts の execArgv）");
    // 最初の数回（接続の確立や JIT）は数えない
    for (const path of READ_PATHS) await probe.call("GET", path);
    gc();
    const { heapUsed: before } = process.memoryUsage();
    for (let i = 0; i < MEMORY_RUNS; i++) {
      await probe.call("GET", READ_PATHS[i % READ_PATHS.length] ?? "/api/health");
    }
    gc();
    const { heapUsed: after } = process.memoryUsage();
    const mb = (bytes: number): number => Math.round((bytes / 1024 / 1024) * 10) / 10;
    results.record({ id: "heap-growth", value: mb(after - before) });
  });

  it("measures the read APIs and the SQL per request", async () => {
    const [probe] = probes;
    const p95s: { name: string; p95: number }[] = [];
    const queries: number[] = [];
    for (const path of READ_PATHS) {
      const timings: number[] = [];
      for (let i = 0; i < RUNS; i++) {
        const res = await probe.call("GET", path);
        timings.push(res.ms);
        queries.push(res.queries);
      }
      p95s.push({ name: path, p95: percentile.p95(timings) });
    }
    const detail = p95s.map((s) => `${s.name}: ${s.p95}ms`).join(", ");
    results.record({ id: "read-api-p95", value: Math.max(...p95s.map((s) => s.p95)), detail });
    results.record({ id: "sql-per-request", value: Math.max(...queries) });
  });

  it("measures the write APIs", async () => {
    const [probe] = probes;
    const series = new Map<string, number[]>();
    const timed = async (name: string, call: Promise<TimedResponse>): Promise<TimedResponse> => {
      const res = await call;
      series.set(name, [...(series.get(name) ?? []), res.ms]);
      return res;
    };
    const ids: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      const { body } = await timed("POST", probe.call("POST", "/api/options", { title: `性能テストで追加 ${i}` }));
      ids.push((body as Option).id);
    }
    for (const id of ids) await timed("POST achievement", probe.call("POST", `/api/options/${id}/achievements`));
    for (const id of ids) await timed("PATCH title",probe.call("PATCH", `/api/options/${id}`, { title: `改名 ${id}` }));
    for (const id of ids) await timed("PATCH completed", probe.call("PATCH", `/api/options/${id}`, { status: "completed" }));
    for (const id of ids) await timed("PATCH pending", probe.call("PATCH", `/api/options/${id}`, { status: "pending" }));
    // 予定日の保存
    for (const id of ids) await timed("PATCH plan", probe.call("PATCH", `/api/options/${id}`, { plannedOn: "2026-11-23" }));
    // 並び替えは画面のドラッグと同じく、1 件を別の位置へ動かした全件の並びを送る
    const { body } = await probe.call("GET", "/api/options?status=pending");
    const order = (body as Option[]).map((o) => o.id);
    for (let i = 0; i < RUNS; i++) {
      const [moved] = order.splice((i * 37) % order.length, 1);
      order.splice((i * 91) % order.length, 0, moved ?? 0);
      await timed("PUT order", probe.call("PUT", "/api/options/order", { ids: order }));
    }
    for (const id of ids) await timed("DELETE", probe.call("DELETE", `/api/options/${id}`));
    // 利用イベント。画面は 1 件ずつ送るが、重いほうで測るため 1 回に 10 件入れる
    const events = Array.from({ length: 10 }, (_, n) => ({
      type: "client_error",
      payload: { message: `性能テストのエラー ${n}`, route: "/" },
      occurredAt: new Date().toISOString(),
    }));
    for (let i = 0; i < RUNS; i++) await timed("POST events", probe.call("POST", "/api/events", { events }));

    const p95s = [...series].map(([name, timings]) => ({ name, p95: percentile.p95(timings) }));
    const detail = p95s.map((s) => `${s.name}: ${s.p95}ms`).join(", ");
    results.record({ id: "write-api-p95", value: Math.max(...p95s.map((s) => s.p95)), detail });
  });

  // 1MB の写真を 20 回。置き換えの古いファイルの削除まで含めて測る（metrics.md §4）
  it("measures the photo upload", async () => {
    const [probe] = probes;
    const { body: option } = await probe.call("POST", "/api/options", { title: "写真のアップロード" });
    const { id: optionId } = option as Option;
    const { body: achieved } = await probe.call("POST", `/api/options/${optionId}/achievements`);
    const { id } = achieved as Achievement;
    const timings: number[] = [];
    for (let i = 0; i < PHOTO_RUNS; i++) {
      const { ms } = await probe.upload(`/api/achievements/${id}/photo`, "photo", PHOTO, "photo.jpg");
      timings.push(ms);
    }
    await probe.call("DELETE", `/api/options/${optionId}`);
    results.record({ id: "image-upload-p95", value: percentile.p95(timings) });
  });

  it("measures the SQL time and finds full table scans", async () => {
    const short = (sql: string): string => sql.replace(/\s+/g, " ").slice(0, 60);
    const slowest = db
      .statements()
      .map((s) => ({ sql: short(s.sql), p95: percentile.p95(s.durationsMs) }))
      .toSorted((a, b) => b.p95 - a.p95)
      .slice(0, 3);
    const slowDetail = slowest.map((s) => `${s.p95}ms: ${s.sql}`).join(" / ");
    results.record({ id: "sql-p95", value: percentile.p95(db.durationsMs()), detail: `遅い順: ${slowDetail}` });
    // INSERT は表を読まないのに EXPLAIN が type = ALL を返すので、読む SQL（SELECT・UPDATE・DELETE）だけを見る
    const scans: string[] = [];
    for (const { sql, params } of db.statements().filter((s) => !/^\s*INSERT\b/i.test(s.sql))) {
      const [plan] = await pool.query<RowDataPacket[]>(`EXPLAIN ${sql}`, params);
      const full = scanFinder.fullScans(sql, plan);
      if (full.length > 0) scans.push(`${full.join("・")}: ${short(sql)}`);
    }
    results.record({ id: "full-table-scans", value: scans.length, detail: scans.join(" / ") || undefined });
  });
});
