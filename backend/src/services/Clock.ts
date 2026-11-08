// 現在時刻。UT では固定の時刻を返すフェイクを渡す（testing.md §4）
export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
