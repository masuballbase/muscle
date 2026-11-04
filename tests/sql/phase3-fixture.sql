-- LOCAL TEST FIXTURE ONLY. Never apply this file to Supabase.
CREATE SCHEMA auth;
CREATE ROLE authenticated;
CREATE ROLE anon;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
CREATE TABLE public.exercises(id uuid PRIMARY KEY,user_id uuid NOT NULL,name text NOT NULL,record_type text NOT NULL CHECK(record_type IN ('weight_reps','reps','duration')),archived_at timestamptz,UNIQUE(id,user_id),UNIQUE(id,user_id,record_type));
CREATE TABLE public.menus(id uuid PRIMARY KEY,user_id uuid NOT NULL,name text NOT NULL CHECK(length(btrim(name))>0),UNIQUE(id,user_id));
CREATE TABLE public.menu_items(id uuid PRIMARY KEY,user_id uuid NOT NULL,menu_id uuid NOT NULL,exercise_id uuid NOT NULL,position integer NOT NULL CHECK(position>=0),planned_sets integer NOT NULL CHECK(planned_sets>=1),UNIQUE(menu_id,exercise_id),UNIQUE(menu_id,position) DEFERRABLE,FOREIGN KEY(menu_id,user_id) REFERENCES public.menus(id,user_id) ON DELETE CASCADE,FOREIGN KEY(exercise_id,user_id) REFERENCES public.exercises(id,user_id));
CREATE TABLE public.sessions(id uuid PRIMARY KEY,user_id uuid NOT NULL,name text NOT NULL CHECK(length(btrim(name))>0),started_at timestamptz NOT NULL,ended_at timestamptz,status text NOT NULL,revision integer NOT NULL DEFAULT 1 CHECK(revision>=1),UNIQUE(id,user_id),CHECK((status='active' AND ended_at IS NULL) OR (status='completed' AND ended_at IS NOT NULL AND ended_at>=started_at)));
CREATE TABLE public.session_exercises(id uuid PRIMARY KEY,user_id uuid NOT NULL,session_id uuid NOT NULL,exercise_id uuid NOT NULL,exercise_name_snapshot text NOT NULL,record_type_snapshot text NOT NULL,position integer NOT NULL CHECK(position>=0),UNIQUE(session_id,exercise_id),UNIQUE(session_id,position) DEFERRABLE,UNIQUE(id,user_id,record_type_snapshot),FOREIGN KEY(session_id,user_id) REFERENCES public.sessions(id,user_id) ON DELETE CASCADE,FOREIGN KEY(exercise_id,user_id,record_type_snapshot) REFERENCES public.exercises(id,user_id,record_type));
CREATE TABLE public.workout_sets(id uuid PRIMARY KEY,user_id uuid NOT NULL,session_exercise_id uuid NOT NULL,record_type text NOT NULL,position integer NOT NULL CHECK(position>=0),weight_kg numeric CHECK(weight_kg>=0 AND weight_kg<'Infinity'::numeric),reps integer CHECK(reps>=1),duration_seconds integer CHECK(duration_seconds>=1),is_performed boolean NOT NULL DEFAULT false,is_copied boolean NOT NULL DEFAULT false,UNIQUE(session_exercise_id,position) DEFERRABLE,FOREIGN KEY(session_exercise_id,user_id,record_type) REFERENCES public.session_exercises(id,user_id,record_type_snapshot) ON DELETE CASCADE,CHECK((record_type='weight_reps' AND duration_seconds IS NULL AND (NOT is_performed OR (weight_kg IS NOT NULL AND reps IS NOT NULL))) OR (record_type='reps' AND weight_kg IS NULL AND duration_seconds IS NULL AND (NOT is_performed OR reps IS NOT NULL)) OR (record_type='duration' AND weight_kg IS NULL AND reps IS NULL AND (NOT is_performed OR duration_seconds IS NOT NULL))));
DO $$DECLARE relation text;BEGIN FOREACH relation IN ARRAY ARRAY['exercises','menus','menu_items','sessions','session_exercises','workout_sets'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',relation);
 EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',relation);
 EXECUTE format('CREATE POLICY owner_select ON public.%I FOR SELECT TO authenticated USING(auth.uid()=user_id)',relation);
 EXECUTE format('CREATE POLICY owner_insert ON public.%I FOR INSERT TO authenticated WITH CHECK(auth.uid()=user_id)',relation);
 EXECUTE format('CREATE POLICY owner_update ON public.%I FOR UPDATE TO authenticated USING(auth.uid()=user_id) WITH CHECK(auth.uid()=user_id)',relation);
 EXECUTE format('CREATE POLICY owner_delete ON public.%I FOR DELETE TO authenticated USING(auth.uid()=user_id)',relation);
 EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON public.%I TO authenticated',relation);
 END LOOP;END$$;
