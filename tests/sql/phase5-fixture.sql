-- LOCAL PGLITE TEST ONLY. Never apply this file to Supabase.
CREATE TABLE public.inbody_records(id uuid PRIMARY KEY,user_id uuid NOT NULL,measured_on date NOT NULL CHECK(isfinite(measured_on)),imported_at timestamptz NOT NULL,source_filename text,raw_fields jsonb NOT NULL CHECK(jsonb_typeof(raw_fields)='object'));
ALTER TABLE public.inbody_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inbody_records FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_select ON public.inbody_records FOR SELECT TO authenticated USING(auth.uid()=user_id);
CREATE POLICY owner_insert ON public.inbody_records FOR INSERT TO authenticated WITH CHECK(auth.uid()=user_id);
CREATE POLICY owner_update ON public.inbody_records FOR UPDATE TO authenticated USING(auth.uid()=user_id) WITH CHECK(auth.uid()=user_id);
CREATE POLICY owner_delete ON public.inbody_records FOR DELETE TO authenticated USING(auth.uid()=user_id);
GRANT SELECT,INSERT,UPDATE,DELETE ON public.inbody_records TO authenticated;
