// 本番用のイメージのスモークテストで確かめること（testing.md §6 の 8、process.md §5 R7。docs/decisions/0054）
// 起動したコンテナに HTTP で聞き、合わないものを日本語の 1 行ずつで返す（空なら合格）

export type HttpReply = {
  status: number;
  // 名前は小文字
  headers: Record<string, string>;
  body: string;
};

export interface HttpGetter {
  get(path: string): Promise<HttpReply>;
}

const NOINDEX_META = '<meta name="robots" content="noindex">';
const CSP_START = "default-src 'self'";

export class ImageSmokeChecks {
  readonly #http: HttpGetter;

  constructor(http: HttpGetter) {
    this.#http = http;
  }

  // PUBLIC_INDEXING なし（公開の 2 段目まで）で起動したとき
  async hidden(): Promise<string[]> {
    const problems = await this.#common();
    const top = await this.#http.get("/");
    if (top.headers["x-robots-tag"] !== "noindex") problems.push(`/ に X-Robots-Tag: noindex がない（${top.headers["x-robots-tag"] ?? "なし"}）`);
    if (!top.body.includes(NOINDEX_META)) problems.push("/ の本文に noindex の meta がない");
    const metrics = await this.#http.get("/api/metrics");
    if (metrics.status !== 404) problems.push(`/api/metrics がトークンなしで ${metrics.status}（404 のはず）`);
    return problems;
  }

  // PUBLIC_INDEXING=true で起動し直したとき
  async indexed(): Promise<string[]> {
    const problems = await this.#common();
    for (const path of ["/", "/api/health"]) {
      const reply = await this.#http.get(path);
      if (reply.headers["x-robots-tag"] !== undefined) problems.push(`PUBLIC_INDEXING=true なのに ${path} に X-Robots-Tag がある`);
      if (reply.body.includes("noindex")) problems.push(`PUBLIC_INDEXING=true なのに ${path} の本文に noindex がある`);
    }
    return problems;
  }

  async #common(): Promise<string[]> {
    const problems: string[] = [];
    for (const path of ["/api/health", "/api/health/db"]) {
      const reply = await this.#http.get(path);
      if (reply.status !== 200) problems.push(`${path} が ${reply.status}（200 のはず）: ${reply.body.slice(0, 200)}`);
    }
    const top = await this.#http.get("/");
    if (top.status !== 200) problems.push(`/ が ${top.status}（200 のはず）`);
    if (!(top.headers["content-security-policy"] ?? "").startsWith(CSP_START)) problems.push("/ に Content-Security-Policy がない");
    const screen = await this.#http.get("/suggestions/1");
    const html = (screen.headers["content-type"] ?? "").startsWith("text/html") && screen.body.includes('<div id="root">');
    if (screen.status !== 200 || !html) problems.push(`/suggestions/1 が index.html を返さない（${screen.status}）`);
    return problems;
  }
}

// fetch で聞く。リダイレクトはたどらない
export class FetchHttpGetter implements HttpGetter {
  readonly #base: string;

  constructor(base: string) {
    this.#base = base;
  }

  async get(path: string): Promise<HttpReply> {
    const res = await fetch(`${this.#base}${path}`, { redirect: "manual" });
    const headers: Record<string, string> = {};
    res.headers.forEach((value, name) => {
      headers[name] = value;
    });
    return { status: res.status, headers, body: await res.text() };
  }
}

// 手元とテストの DB の接続先を、コンテナから見た手元（host.docker.internal）に向け直す
// CI（Linux）は docker run の --add-host=host.docker.internal:host-gateway で、Docker Desktop は最初から通じる
export class ContainerDatabaseUrl {
  rewrite(url: string): string {
    const parsed = new URL(url);
    if (["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)) parsed.hostname = "host.docker.internal";
    return parsed.toString();
  }
}
