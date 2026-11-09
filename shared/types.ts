// api.md §4 の型。frontend・backend の両方から import type で読む。型だけを書く（architecture.md §2 の L12）

export type OptionStatus = "pending" | "completed";

export type Option = {
  id: number;
  title: string;
  status: OptionStatus;
  suggestionId: number | null;
  // 予定日（2026-11-23 の形の日付だけ）。未定なら null
  plannedOn: string | null;
  achievementCount: number;
  // 写真が付いた達成のうち、いちばん新しいものの写真。なければ null（やったリストのカードに出す）
  latestPhotoUrl: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

// photoUrl はその達成の写真（付いていなければ null）
export type Achievement = { id: number; optionId: number; achievedAt: string; photoUrl: string | null };

// firstStep は追加元の提案の最初の一歩（提案から追加していなければ null）
export type OptionDetail = Option & { achievements: Achievement[]; firstStep: string | null };

// 一歩の大きさ: 1 時間以内 / 半日 / 1 日 / 泊まり
export type SuggestionSize = "hour" | "half_day" | "day" | "overnight";

export type Theme = { id: number; name: string };

export type Tag = { id: number; name: string };

// 一覧の行に出すもの。optionStatus はその提案から追加した option の状態（追加していなければ null）
export type SuggestionSummary = {
  id: number;
  hook: string;
  title: string;
  size: SuggestionSize;
  // 季節の始まりと終わりの月（1〜12、両端を含む）。null なら通年
  seasonFrom: number | null;
  seasonTo: number | null;
  themeId: number;
  // id 順（SuggestionDetail の tags も id 順）
  tagIds: number[];
  optionStatus: OptionStatus | null;
};

// themes は sort_order 順、tags と suggestions は id 順
export type SuggestionCatalog = { themes: Theme[]; tags: Tag[]; suggestions: SuggestionSummary[] };

export type SuggestionDetail = SuggestionSummary & {
  trivia: string;
  firstStep: string;
  tags: Tag[];
  related: SuggestionSummary[];
  // その提案から追加した option の id（追加していなければ null。提案から開くシートで使う）
  optionId: number | null;
};

// 今の端末のアカウントの状態（api.md §6）。hasRecoveryCode は使える復旧コードを発行済みか
export type AccountStatus = { hasAccount: boolean; hasRecoveryCode: boolean; createdAt: string | null };
// code は 4 文字ずつハイフンで区切った 16 文字（ABCD-EFGH-JKMN-PQRS）。この応答でしか返さない
export type RecoveryCode = { code: string };
// replace: この端末の別のアカウントを消して移ってよいか（確認のあとで true にして送り直す）
export type RestoreRequest = { code: string; replace?: boolean };

export type Event = {
  // screens.md §8。画面の閲覧などは送らない（docs/decisions/0031）
  type: "client_error";
  payload: Record<string, unknown>;
  occurredAt: string;
};

export type ApiError = {
  // TOO_MANY_REQUESTS は回数の制限（api.md §6）。Retry-After のヘッダーが付く
  error: { code: "VALIDATION_ERROR" | "NOT_FOUND" | "CONFLICT" | "TOO_MANY_REQUESTS" | "INTERNAL_ERROR"; message: string };
};

// POST /api/account/restore の 409。localItemCount はこの端末のアカウントの項目の件数（確認の文「やりたいこと（N 件）」に出す）
export type RestoreConflict = ApiError & { localItemCount: number };
