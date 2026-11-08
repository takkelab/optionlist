import type { IRouter } from "express";

// ルートを登録する。パスは /api から書く（ExpressApp は app をそのまま渡す。
// 入れ子の Router にすると、エラー時に req.baseUrl が戻り、メトリクスの route ラベルが崩れるため）
export interface Controller {
  register(router: IRouter): void;
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
