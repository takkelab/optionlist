import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import net from "node:net";
import type { AddressInfo } from "node:net";

export interface RunningBackend {
  start(): Promise<string>;
  rssBytes(): Promise<number>;
  stop(): void;
}

// backend を動かすときの Node のオプション。package.json の dev・start と同じにする（性能テストが確かめる）
// 若い世代のヒープを小さくして RSS を抑える。既定のままだと連続 1,000 リクエストで 235MB を超える（docs/decisions/0009）
export const NODE_FLAGS = ["--max-semi-space-size=4"];
const READY = "server running at:";
const START_TIMEOUT_MS = 30_000;

// 性能テスト用に、本物の src/server.ts を別のプロセスで起動する。DB はこのプロセスの DATABASE_URL（テスト用 DB）
// RSS はプロセス全体の値なので、テストの側（fetch や応答の解析）の分が乗らないよう別プロセスで測る（docs/decisions/0009）
export class BackendProcess implements RunningBackend {
  #child: ChildProcess | null = null;
  #baseUrl = "";

  async start(): Promise<string> {
    const port = await this.#freePort();
    const child = spawn(process.execPath, [...NODE_FLAGS, "--import", "tsx", "src/server.ts"], {
      env: { ...process.env, PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.#child = child;
    await this.#waitUntilReady(child);
    this.#baseUrl = `http://127.0.0.1:${port}`;
    return this.#baseUrl;
  }

  // /api/metrics の process_resident_memory_bytes（prom-client の標準メトリクス）
  async rssBytes(): Promise<number> {
    const text = await (await fetch(`${this.#baseUrl}/api/metrics`)).text();
    const match = /^process_resident_memory_bytes (\d+)/m.exec(text);
    if (match === null) throw new Error("/api/metrics に process_resident_memory_bytes がない");
    return Number(match[1]);
  }

  stop(): void {
    this.#child?.kill();
    this.#child = null;
  }

  #waitUntilReady(child: ChildProcess): Promise<void> {
    return new Promise((resolve, reject) => {
      const output: string[] = [];
      const timer = setTimeout(() => reject(new Error(`backend が起動しない: ${output.join("")}`)), START_TIMEOUT_MS);
      const onData = (chunk: Buffer): void => {
        output.push(chunk.toString());
        if (!output.join("").includes(READY)) return;
        clearTimeout(timer);
        resolve();
      };
      const { stdout, stderr } = child;
      stdout?.on("data", onData);
      stderr?.on("data", onData);
      child.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`backend が終了した（${code}）: ${output.join("")}`));
      });
    });
  }

  // 空いているポートを OS に選ばせる
  #freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = net.createServer();
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const { port } = server.address() as AddressInfo;
        server.close(() => resolve(port));
      });
    });
  }
}
