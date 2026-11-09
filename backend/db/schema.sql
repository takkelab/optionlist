\restrict dbmate

-- Dumped from database version 17.11
-- Dumped by pg_dump version 17.11

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: auth_create_user(bytea, bytea); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.auth_create_user(p_session_hash bytea, p_ip_hash bytea) RETURNS TABLE(status text, user_id bigint, retry_after_seconds integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
DECLARE
  v_count int;
  v_oldest timestamptz;
  v_id bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('auth_create_user:' || encode(p_ip_hash, 'hex'), 0));
  SELECT count(*), min(a.occurred_at) INTO v_count, v_oldest
    FROM public.auth_attempts a
   WHERE a.kind = 'create_account' AND a.ip_hash = p_ip_hash AND a.occurred_at > now() - interval '1 hour';
  IF v_count >= 20 THEN
    RETURN QUERY SELECT 'rate_limited'::text, NULL::bigint,
      greatest(1, ceil(extract(epoch FROM (v_oldest + interval '1 hour' - now())))::int);
    RETURN;
  END IF;
  INSERT INTO public.auth_attempts (kind, ip_hash, occurred_at) VALUES ('create_account', p_ip_hash, now());
  INSERT INTO public.users (session_hash, created_at, last_seen_at) VALUES (p_session_hash, now(), now()) RETURNING id INTO v_id;
  RETURN QUERY SELECT 'ok'::text, v_id, NULL::int;
END
$$;


--
-- Name: auth_find_user(bytea); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.auth_find_user(p_session_hash bytea) RETURNS TABLE(user_id bigint, last_seen_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
  SELECT u.id, u.last_seen_at FROM public.users u WHERE u.session_hash = p_session_hash
$$;


--
-- Name: auth_restore(bytea, bytea, bytea, bigint, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.auth_restore(p_code_hash bytea, p_new_session_hash bytea, p_ip_hash bytea, p_current_user_id bigint, p_replace boolean) RETURNS TABLE(status text, user_id bigint, retry_after_seconds integer, local_item_count integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
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


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: achievements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.achievements (
    id bigint NOT NULL,
    option_id bigint NOT NULL,
    achieved_at timestamp(3) with time zone NOT NULL,
    photo_filename character varying(100),
    user_id bigint NOT NULL,
    photo_bytes integer,
    CONSTRAINT chk_achievements_photo_bytes CHECK ((((photo_filename IS NULL) AND (photo_bytes IS NULL)) OR ((photo_filename IS NOT NULL) AND (photo_bytes IS NOT NULL) AND (photo_bytes >= 0))))
);

ALTER TABLE ONLY public.achievements FORCE ROW LEVEL SECURITY;


--
-- Name: achievements_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.achievements ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.achievements_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: auth_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_attempts (
    id bigint NOT NULL,
    kind text NOT NULL,
    ip_hash bytea NOT NULL,
    occurred_at timestamp(3) with time zone NOT NULL,
    CONSTRAINT chk_auth_attempts_kind CHECK ((kind = ANY (ARRAY['create_account'::text, 'restore'::text])))
);


--
-- Name: auth_attempts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.auth_attempts ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.auth_attempts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.events (
    id bigint NOT NULL,
    type character varying(50) NOT NULL,
    payload jsonb NOT NULL,
    occurred_at timestamp(3) with time zone NOT NULL,
    received_at timestamp(3) with time zone NOT NULL
);


--
-- Name: events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.events ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: options; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.options (
    id bigint NOT NULL,
    title character varying(200) NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    suggestion_id bigint,
    sort_order integer NOT NULL,
    planned_on date,
    completed_at timestamp(3) with time zone,
    created_at timestamp(3) with time zone NOT NULL,
    updated_at timestamp(3) with time zone NOT NULL,
    user_id bigint NOT NULL,
    CONSTRAINT chk_options_status CHECK ((status = ANY (ARRAY['pending'::text, 'completed'::text])))
);

ALTER TABLE ONLY public.options FORCE ROW LEVEL SECURITY;


--
-- Name: options_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.options ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.options_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migrations (
    version character varying NOT NULL
);


--
-- Name: suggestion_tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.suggestion_tags (
    suggestion_id bigint NOT NULL,
    tag_id bigint NOT NULL
);


--
-- Name: suggestions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.suggestions (
    id bigint NOT NULL,
    theme_id bigint NOT NULL,
    title character varying(200) NOT NULL,
    hook character varying(100) NOT NULL,
    trivia character varying(300) NOT NULL,
    first_step character varying(100) NOT NULL,
    size text NOT NULL,
    season_from smallint,
    season_to smallint,
    CONSTRAINT chk_suggestions_season CHECK ((((season_from IS NULL) AND (season_to IS NULL)) OR ((season_from IS NOT NULL) AND (season_to IS NOT NULL) AND ((season_from >= 1) AND (season_from <= 12)) AND ((season_to >= 1) AND (season_to <= 12))))),
    CONSTRAINT chk_suggestions_size CHECK ((size = ANY (ARRAY['hour'::text, 'half_day'::text, 'day'::text, 'overnight'::text])))
);


--
-- Name: suggestions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.suggestions ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.suggestions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tags (
    id bigint NOT NULL,
    name character varying(30) NOT NULL
);


--
-- Name: tags_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.tags ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.tags_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: themes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.themes (
    id bigint NOT NULL,
    name character varying(50) NOT NULL,
    sort_order integer NOT NULL
);


--
-- Name: themes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.themes ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.themes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id bigint NOT NULL,
    session_hash bytea NOT NULL,
    recovery_code_hash bytea,
    created_at timestamp(3) with time zone NOT NULL,
    last_seen_at timestamp(3) with time zone NOT NULL
);

ALTER TABLE ONLY public.users FORCE ROW LEVEL SECURITY;


--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.users ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.users_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: achievements achievements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.achievements
    ADD CONSTRAINT achievements_pkey PRIMARY KEY (id);


--
-- Name: auth_attempts auth_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_attempts
    ADD CONSTRAINT auth_attempts_pkey PRIMARY KEY (id);


--
-- Name: events events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_pkey PRIMARY KEY (id);


--
-- Name: options options_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.options
    ADD CONSTRAINT options_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: suggestion_tags suggestion_tags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suggestion_tags
    ADD CONSTRAINT suggestion_tags_pkey PRIMARY KEY (suggestion_id, tag_id);


--
-- Name: suggestions suggestions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suggestions
    ADD CONSTRAINT suggestions_pkey PRIMARY KEY (id);


--
-- Name: tags tags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tags
    ADD CONSTRAINT tags_pkey PRIMARY KEY (id);


--
-- Name: themes themes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.themes
    ADD CONSTRAINT themes_pkey PRIMARY KEY (id);


--
-- Name: achievements uq_achievements_photo_filename; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.achievements
    ADD CONSTRAINT uq_achievements_photo_filename UNIQUE (photo_filename);


--
-- Name: options uq_options_id_user_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.options
    ADD CONSTRAINT uq_options_id_user_id UNIQUE (id, user_id);


--
-- Name: options uq_options_user_id_suggestion_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.options
    ADD CONSTRAINT uq_options_user_id_suggestion_id UNIQUE (user_id, suggestion_id);


--
-- Name: tags uq_tags_name; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tags
    ADD CONSTRAINT uq_tags_name UNIQUE (name);


--
-- Name: users uq_users_recovery_code_hash; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT uq_users_recovery_code_hash UNIQUE (recovery_code_hash);


--
-- Name: users uq_users_session_hash; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT uq_users_session_hash UNIQUE (session_hash);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: idx_achievements_achieved_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_achievements_achieved_at ON public.achievements USING btree (achieved_at);


--
-- Name: idx_achievements_option_id_achieved_at_photo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_achievements_option_id_achieved_at_photo ON public.achievements USING btree (option_id, achieved_at, photo_filename);


--
-- Name: idx_achievements_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_achievements_user_id ON public.achievements USING btree (user_id);


--
-- Name: idx_auth_attempts_kind_ip_hash_occurred_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_auth_attempts_kind_ip_hash_occurred_at ON public.auth_attempts USING btree (kind, ip_hash, occurred_at);


--
-- Name: idx_events_occurred_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_events_occurred_at ON public.events USING btree (occurred_at);


--
-- Name: idx_options_user_id_status_completed_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_options_user_id_status_completed_at ON public.options USING btree (user_id, status, completed_at);


--
-- Name: idx_options_user_id_status_sort_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_options_user_id_status_sort_order ON public.options USING btree (user_id, status, sort_order);


--
-- Name: idx_suggestion_tags_tag_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_suggestion_tags_tag_id ON public.suggestion_tags USING btree (tag_id);


--
-- Name: idx_suggestions_theme_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_suggestions_theme_id ON public.suggestions USING btree (theme_id);


--
-- Name: idx_users_last_seen_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_last_seen_at ON public.users USING btree (last_seen_at);


--
-- Name: achievements fk_achievements_option_user; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.achievements
    ADD CONSTRAINT fk_achievements_option_user FOREIGN KEY (option_id, user_id) REFERENCES public.options(id, user_id) ON DELETE CASCADE;


--
-- Name: options fk_options_suggestion; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.options
    ADD CONSTRAINT fk_options_suggestion FOREIGN KEY (suggestion_id) REFERENCES public.suggestions(id);


--
-- Name: options fk_options_user; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.options
    ADD CONSTRAINT fk_options_user FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: suggestion_tags fk_suggestion_tags_suggestion; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suggestion_tags
    ADD CONSTRAINT fk_suggestion_tags_suggestion FOREIGN KEY (suggestion_id) REFERENCES public.suggestions(id);


--
-- Name: suggestion_tags fk_suggestion_tags_tag; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suggestion_tags
    ADD CONSTRAINT fk_suggestion_tags_tag FOREIGN KEY (tag_id) REFERENCES public.tags(id);


--
-- Name: suggestions fk_suggestions_theme; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suggestions
    ADD CONSTRAINT fk_suggestions_theme FOREIGN KEY (theme_id) REFERENCES public.themes(id);


--
-- Name: achievements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.achievements ENABLE ROW LEVEL SECURITY;

--
-- Name: achievements achievements_app; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY achievements_app ON public.achievements TO ol_app USING ((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::bigint)) WITH CHECK ((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::bigint));


--
-- Name: achievements achievements_cleanup_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY achievements_cleanup_delete ON public.achievements FOR DELETE TO ol_cleanup USING (true);


--
-- Name: achievements achievements_cleanup_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY achievements_cleanup_select ON public.achievements FOR SELECT TO ol_cleanup USING (true);


--
-- Name: achievements achievements_definer; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY achievements_definer ON public.achievements TO ol_definer USING (true) WITH CHECK (true);


--
-- Name: achievements achievements_incident; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY achievements_incident ON public.achievements FOR SELECT TO ol_incident USING (true);


--
-- Name: achievements achievements_migrator; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY achievements_migrator ON public.achievements TO ol_migrator USING (true) WITH CHECK (true);


--
-- Name: options; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.options ENABLE ROW LEVEL SECURITY;

--
-- Name: options options_app; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY options_app ON public.options TO ol_app USING ((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::bigint)) WITH CHECK ((user_id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::bigint));


--
-- Name: options options_cleanup_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY options_cleanup_delete ON public.options FOR DELETE TO ol_cleanup USING (true);


--
-- Name: options options_cleanup_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY options_cleanup_select ON public.options FOR SELECT TO ol_cleanup USING (true);


--
-- Name: options options_definer; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY options_definer ON public.options TO ol_definer USING (true) WITH CHECK (true);


--
-- Name: options options_incident; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY options_incident ON public.options FOR SELECT TO ol_incident USING (true);


--
-- Name: options options_migrator; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY options_migrator ON public.options TO ol_migrator USING (true) WITH CHECK (true);


--
-- Name: users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

--
-- Name: users users_app; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_app ON public.users TO ol_app USING ((id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::bigint)) WITH CHECK ((id = (NULLIF(current_setting('app.user_id'::text, true), ''::text))::bigint));


--
-- Name: users users_cleanup_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_cleanup_delete ON public.users FOR DELETE TO ol_cleanup USING (true);


--
-- Name: users users_cleanup_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_cleanup_select ON public.users FOR SELECT TO ol_cleanup USING (true);


--
-- Name: users users_definer; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_definer ON public.users TO ol_definer USING (true) WITH CHECK (true);


--
-- Name: users users_incident; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_incident ON public.users FOR SELECT TO ol_incident USING (true);


--
-- Name: users users_migrator; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_migrator ON public.users TO ol_migrator USING (true) WITH CHECK (true);


--
-- PostgreSQL database dump complete
--

\unrestrict dbmate


--
-- Dbmate schema migrations
--

INSERT INTO public.schema_migrations (version) VALUES
    ('20261108000000'),
    ('20261108120000'),
    ('20261108130000'),
    ('20261109030405');
