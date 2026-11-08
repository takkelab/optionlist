// そのリクエストの人の ID を res.locals に置く・読む（architecture.md §3.1。controllers が読んで services に引数で渡す）
// Express の Response はこの形を満たし、UT ではフェイクを渡す
export interface LocalsHolder {
  locals: Record<string, unknown>;
}

export interface CurrentUser {
  // アカウントがない人なら null
  of(res: LocalsHolder): number | null;
  set(res: LocalsHolder, userId: number | null): void;
}

const KEY = "userId";

export class SessionLocals implements CurrentUser {
  of(res: LocalsHolder): number | null {
    const { locals } = res;
    const value = locals[KEY];
    return typeof value === "number" ? value : null;
  }

  set(res: LocalsHolder, userId: number | null): void {
    const { locals } = res;
    locals[KEY] = userId;
  }
}
