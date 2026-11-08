import type { RequestHandler } from "express";

// ルートを登録する口。Express の app はこの形を満たす。分離テスト（testing.md §7）は記録用のフェイク（tests/fakes/RouteRecorder.ts）を渡して、
// 登録されたルートをすべて集める
export interface Routes {
  get(path: string, ...handlers: RequestHandler[]): unknown;
  post(path: string, ...handlers: RequestHandler[]): unknown;
  put(path: string, ...handlers: RequestHandler[]): unknown;
  patch(path: string, ...handlers: RequestHandler[]): unknown;
  delete(path: string, ...handlers: RequestHandler[]): unknown;
}

// ルートを登録する。パスは /api から書く（ExpressApp は app をそのまま渡す。
// 入れ子の Router にすると、エラー時に req.baseUrl が戻り、メトリクスの route ラベルが崩れるため）
export interface Controller {
  register(router: Routes): void;
}

// ハンドラが使う Response の範囲。Express の Response はこの形を満たし、UT ではフェイクを渡す
export interface JsonResponse {
  status(code: number): JsonResponse;
  json(body: unknown): void;
  // 本文なしで返す（204）
  end(): void;
}

export interface TextResponse {
  type(contentType: string): TextResponse;
  send(body: string): void;
}
