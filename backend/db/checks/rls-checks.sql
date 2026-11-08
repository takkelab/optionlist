-- RLS とロールの確かめ（testing.md §7 の 2。docs/decisions/0046）
-- 「-- check: <名前>」から次の「-- check:」までが 1 つの検査で、違反を 1 行ずつ返す（0 行なら合格）
-- マイグレーションのテスト（backend/tests/migrations/rls.test.ts）と infra:check（process.md §5 の R8・R10）が同じものを流す
-- どの環境（CI・確認用・本番）でも除外なしで流す。障害対応で ol_incident を付けたままなら、strong_role_memberships が落ちるのが正しい

-- check: no_bypassrls_or_superuser
-- どの ol_* ロールも BYPASSRLS とスーパーユーザーを持たない（data.md §4）
SELECT rolname AS violation FROM pg_roles
 WHERE rolname LIKE 'ol\_%' AND (rolbypassrls OR rolsuper);

-- check: app_owns_nothing
-- ol_app はどの表・ビュー・関数の持ち主でもない（持ち主は FORCE がなければ RLS を受けない）
SELECT c.relname AS violation FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND pg_get_userbyid(c.relowner) = 'ol_app'
UNION ALL
SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND pg_get_userbyid(p.proowner) = 'ol_app';

-- check: one_app_policy_per_table
-- RLS のある表ごとに、ol_app か PUBLIC に当たるポリシーがちょうど 1 本で、ALL の USING と WITH CHECK が
-- app.user_id と比べる決まった式（users は id、ほかは user_id）であること（permissive のポリシーは OR で効くので、2 本目があれば他人の行が見えうる）
WITH expected AS (
  SELECT c.relname AS tablename,
         format('(%s = (NULLIF(current_setting(''app.user_id''::text, true), ''''::text))::bigint)',
                CASE WHEN c.relname = 'users' THEN 'id' ELSE 'user_id' END) AS expr
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
)
SELECT e.tablename || '（' || count(p.policyname) || ' 本）' AS violation
  FROM expected e
  LEFT JOIN pg_policies p
    ON p.schemaname = 'public' AND p.tablename = e.tablename AND p.roles && ARRAY['ol_app', 'public']::name[]
 GROUP BY e.tablename, e.expr
HAVING count(p.policyname) <> 1
    OR bool_or(p.cmd <> 'ALL' OR p.permissive <> 'PERMISSIVE' OR p.qual IS DISTINCT FROM e.expr OR p.with_check IS DISTINCT FROM e.expr);

-- check: true_policies_only_for_strong_roles
-- USING (true)・WITH CHECK (true) のポリシーは ol_migrator・ol_cleanup・ol_definer・ol_incident 宛てにしかない（PUBLIC 宛ても許さない）
SELECT tablename || '.' || policyname AS violation FROM pg_policies
 WHERE schemaname = 'public' AND (qual = 'true' OR with_check = 'true')
   AND NOT (roles <@ ARRAY['ol_migrator', 'ol_cleanup', 'ol_definer', 'ol_incident']::name[]);

-- check: app_is_not_a_member_of_other_roles
-- ポリシーは TO のロールのメンバーにも効くので、ol_app がほかの ol_* のメンバーになると全員の行が見える
SELECT r.rolname AS violation FROM pg_roles r
 WHERE r.rolname LIKE 'ol\_%' AND r.rolname <> 'ol_app' AND pg_has_role('ol_app', r.oid, 'MEMBER');

-- check: strong_role_memberships
-- 強いロールへのメンバーシップで、権限を引き継ぐ（INHERIT）か SET ROLE できる（SET）ものは、メンバーが誰でも 0 件
-- 例外は ADMIN だけのもの（PostgreSQL 16 以降でロールを作ったユーザーに付く形）と、ol_migrator → ol_definer の SET だけ（data.md §4）
SELECT pg_get_userbyid(m.member) || ' → ' || r.rolname AS violation
  FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.roleid
 WHERE r.rolname IN ('ol_migrator', 'ol_cleanup', 'ol_definer', 'ol_incident')
   AND (m.inherit_option OR m.set_option)
   AND NOT (r.rolname = 'ol_definer' AND pg_get_userbyid(m.member) = 'ol_migrator' AND m.set_option AND NOT m.inherit_option);

-- check: incident_reads_only
-- ol_incident の表の権限は SELECT だけ
SELECT c.relname || ': ' || a.privilege_type AS violation
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace, aclexplode(c.relacl) a
 WHERE n.nspname = 'public' AND a.grantee = 'ol_incident'::regrole AND a.privilege_type <> 'SELECT';

-- check: cleanup_cannot_insert_or_update
-- 削除のジョブ（ol_cleanup）は読むのと消すのだけ（data.md §5）
SELECT c.relname || ': ' || a.privilege_type AS violation
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace, aclexplode(c.relacl) a
 WHERE n.nspname = 'public' AND a.grantee = 'ol_cleanup'::regrole AND a.privilege_type NOT IN ('SELECT', 'DELETE');

-- check: metrics_reads_only_usage_views
-- ol_metrics が読めるのは集計のビュー（usage_*）だけ（docs/decisions/0043）
SELECT c.relname || ': ' || a.privilege_type AS violation
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace, aclexplode(c.relacl) a
 WHERE n.nspname = 'public' AND a.grantee = 'ol_metrics'::regrole
   AND (c.relkind <> 'v' OR c.relname NOT LIKE 'usage\_%' OR a.privilege_type <> 'SELECT');

-- check: usage_views_readers
-- usage_* のビューを読めるのは ol_metrics と持ち主だけ
SELECT c.relname || ': ' || CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS violation
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace, aclexplode(c.relacl) a
 WHERE n.nspname = 'public' AND c.relkind = 'v' AND c.relname LIKE 'usage\_%'
   AND a.grantee <> c.relowner AND a.grantee <> 'ol_metrics'::regrole;

-- check: auth_functions_are_definer_with_fixed_search_path
-- 認証の関数は SECURITY DEFINER で、search_path を固定し、持ち主は ol_definer（data.md §4）
SELECT p.proname AS violation FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname LIKE 'auth\_%'
   AND (NOT p.prosecdef OR pg_get_userbyid(p.proowner) <> 'ol_definer'
        OR NOT EXISTS (SELECT 1 FROM unnest(p.proconfig) cfg WHERE cfg LIKE 'search\_path=%'));

-- check: auth_functions_execute_only_by_app
-- 認証の関数を実行できるのは ol_app だけ（と、REVOKE しても実行できる持ち主の ol_definer）。PUBLIC と、ほかの ol_* は実行できない
-- 関数は既定で PUBLIC が実行できる（proacl が NULL なら PUBLIC に EXECUTE がある）
SELECT p.proname || ': PUBLIC' AS violation FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname LIKE 'auth\_%'
   AND (p.proacl IS NULL OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'))
UNION ALL
SELECT p.proname || ': ' || r.rolname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace CROSS JOIN pg_roles r
 WHERE n.nspname = 'public' AND p.proname LIKE 'auth\_%'
   AND r.rolname LIKE 'ol\_%' AND r.rolname NOT IN ('ol_app', 'ol_definer')
   AND has_function_privilege(r.oid, p.oid, 'EXECUTE');
