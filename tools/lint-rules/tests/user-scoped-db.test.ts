import { userScopedDb } from "../rules/user-scoped-db.ts";
import { tester } from "./tester.ts";

const REPO = "backend/src/repositories/OptionRepository.ts";
const SCOPES = 'import type { Queryable, UserScopes } from "../infra/PgDatabase";';
const RAW = 'import type { Database } from "../infra/PgDatabase";';

tester.run("user-scoped-db", userScopedDb, {
  valid: [
    // UserScopes を受け取るクラスは利用者の表を読み書きしてよい
    { filename: REPO, code: `${SCOPES}\nconst SQL = "SELECT id FROM options WHERE user_id = $1";` },
    { filename: REPO, code: `${SCOPES}\nconst sql = \`UPDATE options SET \${sets} WHERE user_id = $1\`;` },
    { filename: REPO, code: `${SCOPES}\nconst SQL = "INSERT INTO achievements (user_id) VALUES ($1)";` },
    // 許可リストのクラスは生の Database を使ってよい
    { filename: "backend/src/repositories/AccountRepository.ts", code: `${RAW}\nconst SQL = "SELECT user_id FROM auth_find_user($1)";` },
    { filename: "backend/src/repositories/EventRepository.ts", code: `${RAW}\nconst SQL = "INSERT INTO events (type) VALUES ($1)";` },
    { filename: "backend/src/jobs/cleanup.ts", code: `${RAW}\nconst SQL = "DELETE FROM users WHERE last_seen_at < $1";` },
    // マスターデータだけなら生の Database でよい
    { filename: "backend/src/repositories/ThemeRepository.ts", code: `${RAW}\nconst SQL = "SELECT id FROM themes";` },
    // UPDATE … SET col = は文頭の SET ではない
    { filename: REPO, code: `${SCOPES}\nconst SQL = "UPDATE options SET sort_order = $2 WHERE user_id = $1";` },
    { filename: REPO, code: `${SCOPES}\nconst sql = \`UPDATE options SET \${"title"} = $2\`;` },
    // infra の中は set_config・SET・pg を使ってよい
    { filename: "backend/src/infra/PgDatabase.ts", code: 'import pg from "pg";\nconst SQL = "SELECT set_config(\'app.user_id\', $1, true)";' },
    { filename: "backend/src/infra/PgDatabase.ts", code: 'const SQL = "SET LOCAL statement_timeout = 1000";' },
    // SQL ではない文字列
    { filename: REPO, code: 'const message = "users の一覧";' },
    { filename: REPO, code: 'const message = count + " 件の options";' },
    // 連結でも、マスターデータだけなら生の Database でよい
    { filename: "backend/src/repositories/ThemeRepository.ts", code: `${RAW}\nconst SQL = "SELECT id " + "FROM themes";` },
  ],
  invalid: [
    // 生の Database で利用者の表を読む
    { filename: REPO, code: `${RAW}\nconst SQL = "SELECT id FROM options WHERE id = $1";`, errors: [{ messageId: "rawDatabase" }] },
    { filename: REPO, code: `${RAW}\nconst sql = \`SELECT \${cols} FROM achievements a\`;`, errors: [{ messageId: "rawDatabase" }] },
    { filename: REPO, code: `${RAW}\nconst SQL = "s LEFT JOIN options o ON o.suggestion_id = s.id";`, errors: [{ messageId: "rawDatabase" }] },
    { filename: REPO, code: `${RAW}\nconst SQL = "UPDATE users SET last_seen_at = $2";`, errors: [{ messageId: "rawDatabase" }] },
    // スキーマ付き・引用符付き・FROM のコンマの並び・文字列の連結
    { filename: REPO, code: `${RAW}\nconst SQL = "SELECT id FROM public.options";`, errors: [{ messageId: "rawDatabase" }] },
    { filename: REPO, code: `${RAW}\nconst SQL = 'SELECT id FROM "options"';`, errors: [{ messageId: "rawDatabase" }] },
    { filename: REPO, code: `${RAW}\nconst SQL = 'SELECT 1 FROM "public"."users"';`, errors: [{ messageId: "rawDatabase" }] },
    { filename: REPO, code: `${RAW}\nconst SQL = "SELECT s.id FROM suggestions s, options o WHERE o.suggestion_id = s.id";`, errors: [{ messageId: "rawDatabase" }] },
    { filename: REPO, code: `${RAW}\nconst SQL = "SELECT id FROM " + "options";`, errors: [{ messageId: "rawDatabase" }] },
    { filename: REPO, code: `${RAW}\nconst SQL = "SELECT " + cols + " FROM " + "achievements";`, errors: [{ messageId: "rawDatabase" }] },
    // 拡張子付きの import でも生の Database を見つける
    { filename: REPO, code: 'import type { Database } from "../infra/PgDatabase.js";\nconst SQL = "SELECT id FROM options";', errors: [{ messageId: "rawDatabase" }] },
    { filename: REPO, code: 'import { Pool } from "pg/lib/pool";', errors: [{ messageId: "pgImport" }] },
    // UserScopes を受け取らずに利用者の表を触る
    { filename: REPO, code: 'const SQL = "INSERT INTO options (title) VALUES ($1)";', errors: [{ messageId: "rawDatabase" }] },
    // 両方 import していても、生の Database があれば違反
    { filename: REPO, code: `${RAW}\n${SCOPES}\nconst SQL = "DELETE FROM options WHERE id = $1";`, errors: [{ messageId: "rawDatabase" }] },
    // infra の外の set_config・SET
    { filename: REPO, code: `${SCOPES}\nconst SQL = "SELECT set_config('app.user_id', $1, false)";`, errors: [{ messageId: "setConfig" }] },
    { filename: "backend/src/services/X.ts", code: 'const SQL = "SET app.user_id = 1";', errors: [{ messageId: "setConfig" }] },
    { filename: REPO, code: 'const sql = `BEGIN; SET LOCAL app.user_id = ${id}`;', errors: [{ messageId: "setConfig" }] },
    // infra の外の pg
    { filename: REPO, code: 'import pg from "pg";', errors: [{ messageId: "pgImport" }] },
    { filename: "backend/src/services/X.ts", code: 'import type { Pool } from "pg";', errors: [{ messageId: "pgImport" }] },
  ],
});
