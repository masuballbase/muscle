-- LOCAL TEST FIXTURE ONLY. Never apply this file to Supabase.
-- Mirrors the existing goal table/constraints confirmed in the Phase 1 audit.
CREATE TABLE public.weekly_goal_schedule(
 id uuid PRIMARY KEY, user_id uuid NOT NULL,
 effective_monday date NOT NULL CHECK(isfinite(effective_monday) AND extract(isodow FROM effective_monday)=1),
 target_days integer NOT NULL CHECK(target_days>=1), UNIQUE(user_id,effective_monday)
);
ALTER TABLE public.weekly_goal_schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weekly_goal_schedule FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_select ON public.weekly_goal_schedule FOR SELECT TO authenticated USING(auth.uid()=user_id);
CREATE POLICY owner_insert ON public.weekly_goal_schedule FOR INSERT TO authenticated WITH CHECK(auth.uid()=user_id);
CREATE POLICY owner_update ON public.weekly_goal_schedule FOR UPDATE TO authenticated USING(auth.uid()=user_id) WITH CHECK(auth.uid()=user_id);
CREATE POLICY owner_delete ON public.weekly_goal_schedule FOR DELETE TO authenticated USING(auth.uid()=user_id);
GRANT SELECT,INSERT,UPDATE,DELETE ON public.weekly_goal_schedule TO authenticated;
