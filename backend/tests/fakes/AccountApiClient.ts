import { TestImages } from "./TestImages";
import type { Express } from "express";
import type { Pool } from "pg";
import type { Achievement, RecoveryCode } from "../../../shared/types";
import { OptionsApiClient, SessionAgent } from "./OptionsApiClient";
import type { ApiResult } from "./OptionsApiClient";

// 項目を 1 件追加し、達成して写真を付けた人。photo はファイル名
export type PhotoOwner = { agent: SessionAgent; photo: string };

export interface AccountClient {
  withPhoto(title: string, cookie?: string | null): Promise<PhotoOwner>;
  // 復旧コードを発行する（201 でなければ投げる）
  issue(agent: SessionAgent): Promise<string>;
  restore(agent: SessionAgent, body: object): Promise<ApiResult>;
  // restore の status だけ
  restoreStatus(agent: SessionAgent, body: object): Promise<number>;
  // やりたいリストのタイトル（並び順）
  titles(agent: SessionAgent): Promise<string[]>;
  // users・options・achievements の件数（ol_migrator で全員の行を数える）
  counts(): Promise<number[]>;
}

// backend は sharp で作り直す（api.md §5）ので、本物の JPEG を送る
const JPEG = await new TestImages().jpeg();

// アカウントの API テスト（tests/api/account.test.ts）の操作
export class AccountApiClient implements AccountClient {
  readonly #app: Express;
  readonly #pool: Pool;

  constructor(app: Express, pool: Pool) {
    this.#app = app;
    this.#pool = pool;
  }

  async withPhoto(title: string, cookie: string | null = null): Promise<PhotoOwner> {
    const api = new OptionsApiClient(this.#app, cookie);
    const option = await api.added(title);
    const { body } = await api.achieve(option.id);
    const { id } = body as Achievement;
    const uploaded = await api.upload(`/api/achievements/${id}/photo`, JPEG, "p.jpg");
    const { photoUrl } = uploaded.body as Achievement;
    return { agent: new SessionAgent(this.#app, api.cookie()), photo: String(photoUrl).replace("/api/photos/", "") };
  }

  async issue(agent: SessionAgent): Promise<string> {
    const { status, body } = await agent.send((r) => r.post("/api/account/recovery-code"));
    if (status !== 201) throw new Error(`復旧コードを発行できなかった: ${status}`);
    const { code } = body as RecoveryCode;
    return code;
  }

  restore(agent: SessionAgent, body: object): Promise<ApiResult> {
    return agent.send((r) => r.post("/api/account/restore").send(body));
  }

  async restoreStatus(agent: SessionAgent, body: object): Promise<number> {
    const { status } = await this.restore(agent, body);
    return status;
  }

  async titles(agent: SessionAgent): Promise<string[]> {
    const { body } = await agent.send((r) => r.get("/api/options?status=pending"));
    return (body as { title: string }[]).map((option) => option.title);
  }

  async counts(): Promise<number[]> {
    const { rows } = await this.#pool.query<{ users: number; options: number; achievements: number }>(
      `SELECT (SELECT COUNT(*) FROM users)::int AS users, (SELECT COUNT(*) FROM options)::int AS options,
              (SELECT COUNT(*) FROM achievements)::int AS achievements`,
    );
    const [row] = rows;
    if (row === undefined) throw new Error("件数を読めなかった");
    return [row.users, row.options, row.achievements];
  }
}
