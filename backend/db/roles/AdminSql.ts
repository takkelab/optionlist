// RoleSetup が使う、管理用のユーザー（ADMIN_DATABASE_URL）での接続（data.md §4）

export interface AdminSql {
  rows<T>(sql: string, params?: unknown[]): Promise<T[]>;
}

// 同じ管理用のユーザーで、別の DB につなぐ（確認用・本番で、その DB の public スキーマの権限を付けるため。docs/decisions/0056）
export interface AdminSession extends AdminSql {
  close(): Promise<void>;
}

export interface AdminConnector {
  connect(database: string): Promise<AdminSession>;
}
