// 手元から共用の Cloud SQL へ、Cloud SQL Auth Proxy 越しにつなぐ（infra/setup.ts の db・scripts/infra-check.ts の RLS の確かめ）
// Proxy は gcloud のコンポーネント（gcloud components install cloud-sql-proxy）。gcloud のログインで入る（--gcloud-auth）
import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { connect } from "node:net";
import { INSTANCE_CONNECTION, PROJECT_ID, PROXY_PORT, proxyDatabaseUrl } from "../config.ts";
import type { Gcloud } from "./gcloud.ts";

export const readSecret = (gcloud: Gcloud, name: string): string => {
  const result = gcloud.read(["secrets", "versions", "access", "latest"], { project: PROJECT_ID, secret: name });
  if (!result.ok) throw new Error(`秘密の値 ${name} を読めなかった\n${result.stderr}`);
  return result.stdout;
};

const portOpen = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.end();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });

export class CloudSqlProxy {
  readonly #child: ChildProcess;
  readonly #port: number;

  private constructor(child: ChildProcess, port: number) {
    this.#child = child;
    this.#port = port;
  }

  // connection・port は、復旧の訓練が一時的なインスタンスにつなぐときだけ変える（共用のインスタンスの Proxy と同時に動かす）
  static async start(connection: string = INSTANCE_CONNECTION, port: number = PROXY_PORT): Promise<CloudSqlProxy> {
    if (await portOpen(port)) throw new Error(`ポート ${port} がもう使われている（前の Proxy が残っていないか確かめる）`);
    const child = spawn(`cloud-sql-proxy --gcloud-auth --port ${port} ${connection}`, { shell: true, stdio: ["ignore", "ignore", "pipe"] });
    let log = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      log += chunk.toString();
    });
    for (let i = 0; i < 30; i++) {
      if (child.exitCode !== null) break;
      if (await portOpen(port)) return new CloudSqlProxy(child, port);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    child.kill();
    throw new Error(`Cloud SQL Auth Proxy が起動しなかった（gcloud components install cloud-sql-proxy で入れる）\n${log}`);
  }

  url(user: string, password: string, database: string): string {
    return proxyDatabaseUrl(user, password, database, this.#port);
  }

  stop(): void {
    // shell 経由で起動したので、Windows では子のプロセスごと止める。止め終わるまで待つ（すぐ process.exit すると止めきれず、ポートが残る）
    if (process.platform === "win32" && this.#child.pid !== undefined) spawnSync("taskkill", ["/pid", String(this.#child.pid), "/t", "/f"], { stdio: "ignore" });
    else this.#child.kill();
  }
}
