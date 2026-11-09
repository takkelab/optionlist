// アカウントの状態のうち、勧めるかどうかに使うもの（GET /api/account）
export type PromptAccount = { hasAccount: boolean; hasRecoveryCode: boolean }

export type PromptState = {
  // やりたいリストの件数
  pendingCount: number
  photoSaved: boolean
  // [控える]・[あとで] で答えたか、どこかで復旧コードを発行したか
  answered: boolean
  // まだ読んでいなければ null
  account: PromptAccount | null
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
// アカウントがない（すべて消した・前の端末で引き継がれた）とき、すでにコードを発行しているときは出さない。🎉 の流れ（シート）の途中では出さない
export class RecoveryPrompt implements PromptRule {
  needsStatus(state: PromptState): boolean {
    const { pendingCount, photoSaved, answered } = state
    return !answered && (photoSaved || pendingCount >= PENDING_TRIGGER)
  }

  shows(state: PromptState): boolean {
    const { account, sheetOpen } = state
    if (account === null || !this.needsStatus(state) || sheetOpen) return false
    const { hasAccount, hasRecoveryCode } = account
    return hasAccount && !hasRecoveryCode
  }
}
