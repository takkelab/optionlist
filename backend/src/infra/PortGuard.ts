import net from "node:net";

export interface PortCheck {
  ensureFree(port: number): Promise<void>;
}

export class PortInUseError extends Error {}

// Windows では別のアプリ（off-jt の backend など）が同じポートで待ち受けていても listen が失敗しないことがあり、
// Vite のプロキシが別のアプリに届いて "Cannot GET" になる。listen の前に実際に接続してみて確かめる（docs/decisions/0007）
const HOSTS = ["127.0.0.1", "::1"];

export class PortGuard implements PortCheck {
  readonly #timeoutMs: number;

  constructor(timeoutMs: number) {
    this.#timeoutMs = timeoutMs;
  }

  async ensureFree(port: number): Promise<void> {
    const results = await Promise.all(HOSTS.map((host) => this.#isListening(host, port)));
    if (results.includes(true)) {
      throw new PortInUseError(this.message(port));
    }
  }

  message(port: number): string {
    return (
      `${port} 番ポートは別のアプリ（off-jt の backend など）が使っています。` +
      `そのアプリを止めてから起動してください（PORT を変えるなら、frontend の Vite のプロキシ先も BACKEND_URL で同じポートにする）。` +
      `使っているプロセスは \`netstat -ano | findstr :${port}\` で確かめられます`
    );
  }

  #isListening(host: string, port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = net.connect({ host, port });
      socket.setTimeout(this.#timeoutMs);
      socket.once("connect", () => {
        socket.end();
        resolve(true);
      });
      // つながらない（ECONNREFUSED、IPv6 が無効など）・時間切れは「使われていない」とみなす
      socket.once("error", () => resolve(false));
      socket.once("timeout", () => {
        socket.destroy();
        resolve(false);
      });
    });
  }
}
