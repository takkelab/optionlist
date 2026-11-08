import type { CookieOptions } from "express";

// Set-Cookie を書く口。Express の Response はこの形を満たし、UT ではフェイクを渡す
export interface CookieResponse {
  cookie(name: string, value: string, options: CookieOptions): unknown;
}

export interface SessionCookieJar {
  // Cookie ヘッダーから鍵を読む。なければ null
  read(cookieHeader: string | undefined): string | null;
  write(res: CookieResponse, sessionKey: string): void;
}

// Chrome は Cookie の期限を最長 400 日に切り詰める（api.md §6）
const MAX_AGE_MS = 400 * 24 * 60 * 60 * 1000;

// セッションの Cookie（api.md §6）。HttpOnly・SameSite=Lax・Path=/・Max-Age 400 日
// secure（確認用・本番の https）なら名前を __Host-ol_session にして Secure を付ける。手元の開発とテスト（http）は ol_session
export class SessionCookie implements SessionCookieJar {
  readonly #secure: boolean;

  constructor(secure: boolean) {
    this.#secure = secure;
  }

  read(cookieHeader: string | undefined): string | null {
    if (cookieHeader === undefined) return null;
    const name = this.#name();
    for (const pair of cookieHeader.split(";")) {
      const at = pair.indexOf("=");
      if (at >= 0 && pair.slice(0, at).trim() === name) return pair.slice(at + 1).trim();
    }
    return null;
  }

  write(res: CookieResponse, sessionKey: string): void {
    res.cookie(this.#name(), sessionKey, { httpOnly: true, secure: this.#secure, sameSite: "lax", path: "/", maxAge: MAX_AGE_MS });
  }

  #name(): string {
    return this.#secure ? "__Host-ol_session" : "ol_session";
  }
}
