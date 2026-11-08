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

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: achievements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.achievements (
    id bigint NOT NULL,
    option_id bigint NOT NULL,
    achieved_at timestamp(3) with time zone NOT NULL,
    photo_filename character varying(100)
);


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
    CONSTRAINT chk_options_status CHECK ((status = ANY (ARRAY['pending'::text, 'completed'::text])))
);


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
-- Name: achievements achievements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.achievements
    ADD CONSTRAINT achievements_pkey PRIMARY KEY (id);


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
-- Name: options uq_options_suggestion_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.options
    ADD CONSTRAINT uq_options_suggestion_id UNIQUE (suggestion_id);


--
-- Name: tags uq_tags_name; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tags
    ADD CONSTRAINT uq_tags_name UNIQUE (name);


--
-- Name: idx_achievements_achieved_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_achievements_achieved_at ON public.achievements USING btree (achieved_at);


--
-- Name: idx_achievements_option_id_achieved_at_photo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_achievements_option_id_achieved_at_photo ON public.achievements USING btree (option_id, achieved_at, photo_filename);


--
-- Name: idx_events_occurred_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_events_occurred_at ON public.events USING btree (occurred_at);


--
-- Name: idx_options_status_sort_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_options_status_sort_order ON public.options USING btree (status, sort_order);


--
-- Name: idx_suggestion_tags_tag_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_suggestion_tags_tag_id ON public.suggestion_tags USING btree (tag_id);


--
-- Name: idx_suggestions_theme_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_suggestions_theme_id ON public.suggestions USING btree (theme_id);


--
-- Name: achievements fk_achievements_option; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.achievements
    ADD CONSTRAINT fk_achievements_option FOREIGN KEY (option_id) REFERENCES public.options(id) ON DELETE CASCADE;


--
-- Name: options fk_options_suggestion; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.options
    ADD CONSTRAINT fk_options_suggestion FOREIGN KEY (suggestion_id) REFERENCES public.suggestions(id);


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
-- PostgreSQL database dump complete
--

\unrestrict dbmate


--
-- Dbmate schema migrations
--

INSERT INTO public.schema_migrations (version) VALUES
    ('20261108000000');
