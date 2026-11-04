-- PROPOSAL ONLY: requires explicit user approval before application to Supabase.
-- Adds three invoker RPCs; does not replace/drop tables, policies or existing functions.
-- Preconditions: the eight Phase 1 tables, audited constraints and authenticated CRUD grants.
BEGIN;

CREATE FUNCTION public.save_training_menu(
  p_id uuid, p_name text, p_items jsonb, p_expected jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $function$
DECLARE
  actor uuid := auth.uid();
  current_name text;
  current_snapshot jsonb;
  incoming jsonb;
  exercise uuid;
  item_position integer := 0;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  IF p_id IS NULL OR p_name IS NULL OR length(btrim(p_name)) = 0
     OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Invalid menu' USING ERRCODE = '22023';
  END IF;
  SELECT name INTO current_name FROM public.menus WHERE id = p_id AND user_id = actor FOR UPDATE;
  IF FOUND THEN
    SELECT jsonb_build_object('id', p_id, 'name', current_name, 'items', coalesce(jsonb_agg(
      jsonb_build_object('id', id, 'exerciseId', exercise_id, 'plannedSets', planned_sets)
      ORDER BY position), '[]'::jsonb)) INTO current_snapshot
      FROM public.menu_items WHERE menu_id = p_id AND user_id = actor;
    IF current_snapshot IS DISTINCT FROM p_expected THEN
      RAISE EXCEPTION 'Menu changed; reload before saving' USING ERRCODE = '40001';
    END IF;
  ELSE
    IF p_expected IS NOT NULL THEN RAISE EXCEPTION 'Menu not found' USING ERRCODE = 'P0002'; END IF;
    INSERT INTO public.menus(id, user_id, name) VALUES(p_id, actor, btrim(p_name));
  END IF;
  -- All validation and replacements below are in the same RPC transaction.
  FOR incoming IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    exercise := (incoming->>'exerciseId')::uuid;
    PERFORM 1 FROM public.exercises WHERE id = exercise AND user_id = actor AND archived_at IS NULL FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Exercise unavailable' USING ERRCODE = '42501'; END IF;
    IF incoming->>'id' IS NULL OR (incoming->>'plannedSets')::integer IS NULL
       OR (incoming->>'plannedSets')::integer < 1 THEN
      RAISE EXCEPTION 'Invalid menu item' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  DELETE FROM public.menu_items WHERE menu_id = p_id AND user_id = actor;
  FOR incoming IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    INSERT INTO public.menu_items(id, user_id, menu_id, exercise_id, position, planned_sets)
    VALUES((incoming->>'id')::uuid, actor, p_id, (incoming->>'exerciseId')::uuid,
           item_position, (incoming->>'plannedSets')::integer);
    item_position := item_position + 1;
  END LOOP;
  UPDATE public.menus SET name = btrim(p_name) WHERE id = p_id AND user_id = actor;
  SELECT jsonb_build_object('id', p_id, 'name', btrim(p_name), 'items', coalesce(jsonb_agg(
    jsonb_build_object('id', id, 'exerciseId', exercise_id, 'plannedSets', planned_sets)
    ORDER BY position), '[]'::jsonb)) INTO current_snapshot
    FROM public.menu_items WHERE menu_id = p_id AND user_id = actor;
  RETURN current_snapshot;
END;
$function$;
REVOKE ALL ON FUNCTION public.save_training_menu(uuid,text,jsonb,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_training_menu(uuid,text,jsonb,jsonb) TO authenticated;

CREATE FUNCTION public.edit_training_history(
  p_id uuid, p_revision integer, p_name text, p_ended_at timestamptz, p_sections jsonb
) RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $function$
DECLARE
  actor uuid := auth.uid();
  original public.sessions%ROWTYPE;
  old_section public.session_exercises%ROWTYPE;
  master public.exercises%ROWTYPE;
  incoming jsonb;
  incoming_set jsonb;
  resolved jsonb := '[]'::jsonb;
  section_id uuid;
  exercise uuid;
  snapshot_name text;
  snapshot_type text;
  section_position integer := 0;
  set_position integer;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO original FROM public.sessions WHERE id = p_id AND user_id = actor FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'History not found' USING ERRCODE = 'P0002'; END IF;
  IF original.status <> 'completed' THEN RAISE EXCEPTION 'History must be completed' USING ERRCODE = '22023'; END IF;
  IF original.revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'History changed; reload before saving' USING ERRCODE = '40001'; END IF;
  IF p_name IS NULL OR length(btrim(p_name)) = 0 OR p_ended_at IS NULL
     OR NOT isfinite(p_ended_at) OR p_ended_at < original.started_at
     OR jsonb_typeof(p_sections) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invalid history' USING ERRCODE = '22023';
  END IF;
  FOR incoming IN SELECT value FROM jsonb_array_elements(p_sections) LOOP
    section_id := (incoming->>'id')::uuid;
    exercise := (incoming->>'exerciseId')::uuid;
    IF section_id IS NULL OR exercise IS NULL OR jsonb_typeof(incoming->'sets') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Invalid history section' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO old_section FROM public.session_exercises
      WHERE id = section_id AND session_id = p_id AND user_id = actor;
    IF FOUND THEN
      IF old_section.exercise_id <> exercise THEN RAISE EXCEPTION 'Retained section identity must not change' USING ERRCODE = '22023'; END IF;
      -- The client cannot rename historical snapshots or change their type.
      snapshot_name := old_section.exercise_name_snapshot;
      snapshot_type := old_section.record_type_snapshot;
    ELSE
      SELECT * INTO master FROM public.exercises WHERE id = exercise AND user_id = actor AND archived_at IS NULL FOR SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Exercise unavailable' USING ERRCODE = '42501'; END IF;
      snapshot_name := master.name;
      snapshot_type := master.record_type;
    END IF;
    resolved := resolved || jsonb_build_array(jsonb_build_object(
      'id', section_id, 'exerciseId', exercise, 'name', snapshot_name,
      'type', snapshot_type, 'sets', incoming->'sets'));
  END LOOP;
  -- Child DELETEs and INSERTs roll back together if ANY later row fails a constraint.
  DELETE FROM public.session_exercises WHERE session_id = p_id AND user_id = actor;
  FOR incoming IN SELECT value FROM jsonb_array_elements(resolved) LOOP
    section_id := (incoming->>'id')::uuid;
    INSERT INTO public.session_exercises(id,user_id,session_id,exercise_id,exercise_name_snapshot,record_type_snapshot,position)
    VALUES(section_id,actor,p_id,(incoming->>'exerciseId')::uuid,incoming->>'name',incoming->>'type',section_position);
    set_position := 0;
    FOR incoming_set IN SELECT value FROM jsonb_array_elements(incoming->'sets') LOOP
      INSERT INTO public.workout_sets(id,user_id,session_exercise_id,record_type,position,weight_kg,reps,duration_seconds,is_performed,is_copied)
      VALUES((incoming_set->>'id')::uuid,actor,section_id,incoming->>'type',set_position,
        nullif(incoming_set->>'weight','')::numeric, nullif(incoming_set->>'reps','')::integer,
        nullif(incoming_set->>'seconds','')::integer,coalesce((incoming_set->>'performed')::boolean,false),
        coalesce((incoming_set->>'copied')::boolean,false));
      set_position := set_position + 1;
    END LOOP;
    section_position := section_position + 1;
  END LOOP;
  UPDATE public.sessions SET name = btrim(p_name), ended_at = p_ended_at, revision = original.revision + 1
    WHERE id = p_id AND user_id = actor;
  RETURN original.revision + 1;
END;
$function$;
REVOKE ALL ON FUNCTION public.edit_training_history(uuid,integer,text,timestamptz,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.edit_training_history(uuid,integer,text,timestamptz,jsonb) TO authenticated;

CREATE FUNCTION public.archive_training_exercise(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $function$
DECLARE actor uuid := auth.uid();
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  PERFORM 1 FROM public.exercises WHERE id = p_id AND user_id = actor FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Exercise not found' USING ERRCODE = 'P0002'; END IF;
  IF EXISTS(SELECT 1 FROM public.session_exercises AS se JOIN public.sessions AS s
    ON s.id = se.session_id AND s.user_id = se.user_id
    WHERE se.exercise_id = p_id AND se.user_id = actor AND s.status = 'active') THEN
    RAISE EXCEPTION 'Exercise is in an active session' USING ERRCODE = '22023';
  END IF;
  DELETE FROM public.menu_items WHERE exercise_id = p_id AND user_id = actor;
  UPDATE public.exercises SET archived_at = coalesce(archived_at, now()) WHERE id = p_id AND user_id = actor;
END;
$function$;
REVOKE ALL ON FUNCTION public.archive_training_exercise(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.archive_training_exercise(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
