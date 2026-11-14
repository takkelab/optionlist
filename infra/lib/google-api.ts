// Google Cloud の REST API を呼ぶ（infra/setup.ts・scripts/infra-check.ts。監視・ログの指標・予算。docs/decisions/0062）
// 通知先（notificationChannels）は gcloud では beta にしかないので、監視まわりはそろえて REST で扱う。
// トークンは gcloud のログイン中のアカウントのもの。予算の API はユーザーの認証では課金先のプロジェクトが要るので、x-goog-user-project を付ける
import type { Gcloud } from "./gcloud.ts";

export const masked = (text: string): string =>
  text.replace(/[^\s"@/]+@[^\s"@/]+\.[^\s"@/]+/g, "（メールアドレス）").replace(/billingAccounts\/[^/\s"]+/g, "billingAccounts/（請求先アカウント）");

export type ApiResult<T> = { ok: true; body: T } | { ok: false; status: number; message: string };

export class GoogleApi {
  readonly #gcloud: Gcloud;
  readonly #dryRun: boolean;
  readonly #quotaProject: string;
  #token: string | null = null;

  constructor(gcloud: Gcloud, quotaProject: string, dryRun: boolean) {
    this.#gcloud = gcloud;
    this.#quotaProject = quotaProject;
    this.#dryRun = dryRun;
  }

  // 読むだけ。404 などは ok=false で返す
  get<T>(url: string): Promise<ApiResult<T>> {
    return this.#send<T>("GET", url, undefined);
  }

  // 一覧を最後のページまで読む（key は一覧の配列の名前）。読めなければ null
  async list<T>(url: string, key: string): Promise<T[] | null> {
    const items: T[] = [];
    let pageToken = "";
    do {
      const page = await this.get<Record<string, unknown>>(pageToken === "" ? url : `${url}${url.includes("?") ? "&" : "?"}pageToken=${encodeURIComponent(pageToken)}`);
      if (!page.ok) return null;
      items.push(...((page.body[key] ?? []) as T[]));
      pageToken = typeof page.body.nextPageToken === "string" ? page.body.nextPageToken : "";
    } while (pageToken !== "");
    return items;
  }

  // 変える。何をするかを表示してから流し、失敗したら止まる。--dry-run なら表示だけ
  // 表示では、メールアドレスと請求先アカウントの ID を伏せる（dry-run の出力を PR などに貼っても漏れないように。docs/decisions/0062）
  async change<T>(method: "POST" | "PATCH" | "PUT", url: string, body: unknown): Promise<T | null> {
    console.log(`▶ ${method} ${masked(url)}`);
    if (this.#dryRun) {
      console.log(masked(JSON.stringify(body, null, 2)));
      return null;
    }
    const result = await this.#send<T>(method, url, body);
    if (!result.ok) throw new Error(masked(`${method} ${url} が失敗した（${result.status}）: ${result.message}`));
    return result.body;
  }

  async #send<T>(method: string, url: string, body: unknown): Promise<ApiResult<T>> {
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.#accessToken()}`,
        "x-goog-user-project": this.#quotaProject,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) return { ok: false, status: response.status, message: text };
    return { ok: true, body: (text === "" ? {} : JSON.parse(text)) as T };
  }

  #accessToken(): string {
    if (this.#token !== null) return this.#token;
    const result = this.#gcloud.read(["auth", "print-access-token"]);
    if (!result.ok) throw new Error(`gcloud auth print-access-token が失敗した（gcloud auth login が要る）\n${result.stderr}`);
    this.#token = result.stdout.trim();
    return this.#token;
  }
}

// 通知先のメールアドレス。リポジトリは公開なので書かず、gcloud にログインしているアカウント（運営者。docs/decisions/0060）を使う
export const operatorEmail = (gcloud: Gcloud): string => {
  const result = gcloud.read(["config", "get-value", "account"]);
  const email = result.stdout.trim();
  if (!result.ok || !email.includes("@")) throw new Error("gcloud にログインしているアカウントを読めなかった（gcloud auth login が要る）");
  return email;
};

// このプロジェクトの請求先アカウント（billingAccounts/XXXX）。リポジトリには書かない
export const billingAccountOf = (gcloud: Gcloud, project: string): string => {
  const result = gcloud.read(["billing", "projects", "describe", project], { format: "value(billingAccountName)" });
  const name = result.stdout.trim();
  if (!result.ok || !name.startsWith("billingAccounts/")) throw new Error(`プロジェクト ${project} の請求先アカウントを読めなかった`);
  return name;
};
