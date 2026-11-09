// 写真を保存させてもらえなかった理由（429。api.md §3）。full は 1 人あたりの上限、busy は回数の制限
export type PhotoRefusal = 'full' | 'busy'

export interface PhotoRefusalReader {
  // 失敗した応答の status と本文から理由を決める。429 でなければ null
  reasonOf(status: number | undefined, body: unknown): PhotoRefusal | null
}

// 本文は { error: { code } } の形（api.md §1）。前段（Cloud Run など）が返した 429 は本文が JSON でないこともあるので、形を確かめてから読む
export class PhotoRefusals implements PhotoRefusalReader {
  reasonOf(status: number | undefined, body: unknown): PhotoRefusal | null {
    if (status !== 429) return null
    return this.#codeOf(body) === 'PHOTO_LIMIT_REACHED' ? 'full' : 'busy'
  }

  #codeOf(body: unknown): unknown {
    if (typeof body !== 'object' || body === null || !('error' in body)) return undefined
    const { error } = body
    if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
    return error.code
  }
}
