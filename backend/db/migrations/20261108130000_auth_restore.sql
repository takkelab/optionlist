-- migrate:up
-- 復旧コードで別の端末のアカウントに移る（data.md §4 の auth_restore、api.md §6、docs/decisions/0033・0049）
-- ol_definer として作る（持ち主が最初から ol_definer になる。data.md §4）
SET ROLE ol_definer;

-- その IP から直近 1 時間の入力が 10 回未満なら、コードを確かめる（api.md §6 ※仮決め）
-- 数えるのは、合った・合わない・確認が要る、の 3 つ。429 で断った試行は入れない（入れると、待って試し直しても窓が延びて
-- retry_after_seconds が当たらなくなる。docs/decisions/0049）。合っていても上限なら rate_limited で、コードは使わない
-- p_current_user_id がコードの人と別で、その人に項目があり、p_replace が false なら、何も変えずに needs_confirm と件数を返す
-- （達成は項目に付くので、項目の件数で足りる）。ok なら鍵を置き換え、コードを使えなくする。古いアカウントを消すのはアプリ
CREATE FUNCTION auth_restore(
  p_code_hash bytea,
  p_new_session_hash bytea,
  p_ip_hash bytea,
  p_current_user_id bigint,
  p_replace boolean
)
  RETURNS TABLE (status text, user_id bigint, retry_after_seconds int, local_item_count int)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_count int;
  v_oldest timestamptz;
  v_id bigint;
  v_items int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('auth_restore:' || encode(p_ip_hash, 'hex'), 0));
  SELECT count(*), min(a.occurred_at) INTO v_count, v_oldest
    FROM public.auth_attempts a
   WHERE a.kind = 'restore' AND a.ip_hash = p_ip_hash AND a.occurred_at > now() - interval '1 hour';
  IF v_count >= 10 THEN
    RETURN QUERY SELECT 'rate_limited'::text, NULL::bigint,
      greatest(1, ceil(extract(epoch FROM (v_oldest + interval '1 hour' - now())))::int), NULL::int;
    RETURN;
  END IF;
  INSERT INTO public.auth_attempts (kind, ip_hash, occurred_at) VALUES ('restore', p_ip_hash, now());
  SELECT u.id INTO v_id FROM public.users u WHERE u.recovery_code_hash = p_code_hash FOR UPDATE;
  IF v_id IS NULL THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::bigint, NULL::int, NULL::int;
    RETURN;
  END IF;
  IF p_current_user_id IS NOT NULL AND p_current_user_id <> v_id AND NOT p_replace THEN
    SELECT count(*) INTO v_items FROM public.options o WHERE o.user_id = p_current_user_id;
    IF v_items > 0 THEN
      RETURN QUERY SELECT 'needs_confirm'::text, NULL::bigint, NULL::int, v_items;
      RETURN;
    END IF;
  END IF;
  UPDATE public.users SET session_hash = p_new_session_hash, recovery_code_hash = NULL WHERE id = v_id;
  RETURN QUERY SELECT 'ok'::text, v_id, NULL::int, NULL::int;
END
$$;

-- 関数は既定で PUBLIC が実行できる。実行できるのは ol_app だけにする（testing.md §7）
REVOKE EXECUTE ON FUNCTION auth_restore(bytea, bytea, bytea, bigint, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_restore(bytea, bytea, bytea, bigint, boolean) TO ol_app;

RESET ROLE;

-- migrate:down
SET ROLE ol_definer;
DROP FUNCTION auth_restore(bytea, bytea, bytea, bigint, boolean);
RESET ROLE;
