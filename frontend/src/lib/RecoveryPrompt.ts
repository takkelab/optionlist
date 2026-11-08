export type PromptState = {
  // やりたいリストの件数
  pendingCount: number
  photoSaved: boolean
  answered: boolean
  // 使える復旧コードを発行済みか。まだ読んでいなければ null
  hasRecoveryCode: boolean | null
  // 項目のシート（🎉 の流れを含む）が開いているか
  sheetOpen: boolean
}

export interface PromptRule {
  // アカウントの状態を読む必要があるか（ほかの条件がそろったときだけ読む）
  needsStatus(state: PromptState): boolean
  shows(state: PromptState): boolean
}

// やりたいことがこの件数になったら勧める
const PENDING_TRIGGER = 5

// 復旧コードを控えるよう勧めるカード（screens.md §9）。写真を初めて保存したか、やりたいことが 5 件になったときに 1 回だけ。
// すでにコードを発行していれば出さない。🎉 の流れ（シート）の途中では出さない
export class RecoveryPrompt implements PromptRule {
  needsStatus(state: PromptState): boolean {
    const { pendingCount, photoSaved, answered } = state
    return !answered && (photoSaved || pendingCount >= PENDING_TRIGGER)
  }

  shows(state: PromptState): boolean {
    const { hasRecoveryCode, sheetOpen } = state
    return this.needsStatus(state) && hasRecoveryCode === false && !sheetOpen
  }
}
