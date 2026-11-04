-- PROPOSAL: requires explicit approval and SQL Editor application.
-- Adds ONE invoker RPC. No table, RLS, existing RPC, or existing data changes.
-- PT409 is a business conflict; never raise serialization_failure/40001 here.
BEGIN;
CREATE FUNCTION public.sync_training_session(p_workout jsonb, p_expected jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE
 actor uuid := auth.uid(); supplied jsonb; normalized jsonb; candidates jsonb := '[]'::jsonb;
 target jsonb; expected jsonb; actual jsonb; original public.sessions%ROWTYPE;
 section jsonb; item jsonb; section_position integer; set_position integer;
 workout_id uuid;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_workout) IS DISTINCT FROM 'object' OR jsonb_typeof(p_expected) IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_expected)>64 THEN
   RAISE EXCEPTION 'Invalid synchronization envelope' USING ERRCODE='22023';
 END IF;
 -- Normalize both client snapshots and server data in SQL, including timestamps/numbers.
 -- Null in the expected list explicitly means that this device has never seen a server row.
 FOR supplied IN SELECT value FROM jsonb_array_elements(jsonb_build_array(p_workout)||p_expected) LOOP
   IF supplied='null'::jsonb THEN candidates:=candidates||jsonb_build_array(NULL); CONTINUE; END IF;
   IF jsonb_typeof(supplied) IS DISTINCT FROM 'object' OR jsonb_typeof(supplied->'sections') IS DISTINCT FROM 'array'
      OR (supplied->>'revision')::integer<1 THEN
     RAISE EXCEPTION 'Invalid snapshot' USING ERRCODE='22023';
   END IF;
   SELECT jsonb_build_object(
     'id',(supplied->>'id')::uuid,'name',supplied->>'name',
     'startedAt',(supplied->>'startedAt')::timestamptz,'endedAt',(supplied->>'endedAt')::timestamptz,
     'revision',(supplied->>'revision')::integer,
     'sections',coalesce((SELECT jsonb_agg(jsonb_build_object(
       'id',(s.value->>'id')::uuid,'exerciseId',(s.value->>'exerciseId')::uuid,
       'name',s.value->>'name','type',s.value->>'type',
       'sets',coalesce((SELECT jsonb_agg(jsonb_build_object(
         'id',(t.value->>'id')::uuid,
         'weight',CASE WHEN s.value->>'type'='weight_reps' THEN nullif(t.value->>'weight','')::numeric ELSE NULL END,
         'reps',CASE WHEN s.value->>'type'<>'duration' THEN nullif(t.value->>'reps','')::integer ELSE NULL END,
         'seconds',CASE WHEN s.value->>'type'='duration' THEN nullif(t.value->>'seconds','')::integer ELSE NULL END,
         'performed',coalesce((t.value->>'performed')::boolean,false),
         'copied',coalesce((t.value->>'copied')::boolean,false)
       ) ORDER BY t.ordinality) FROM jsonb_array_elements(s.value->'sets') WITH ORDINALITY t), '[]'::jsonb)
     ) ORDER BY s.ordinality) FROM jsonb_array_elements(supplied->'sections') WITH ORDINALITY s),'[]'::jsonb)
   ) INTO normalized;
   candidates:=candidates||jsonb_build_array(normalized);
 END LOOP;
 target:=candidates->0; expected:=candidates-0; workout_id:=(target->>'id')::uuid;
 IF workout_id IS NULL OR target->>'name' IS NULL OR target->>'startedAt' IS NULL OR target->>'revision' IS NULL THEN
   RAISE EXCEPTION 'Missing snapshot fields' USING ERRCODE='22023';
 END IF;
 -- Serialize this RPC's calls for one owner, including creation of a new session ID.
 PERFORM pg_advisory_xact_lock(hashtextextended(actor::text,0));
 SELECT * INTO original FROM public.sessions s WHERE s.id=workout_id AND s.user_id=actor FOR UPDATE;
 IF FOUND THEN
   SELECT jsonb_build_object('id',original.id,'name',original.name,
     'startedAt',original.started_at,'endedAt',original.ended_at,'revision',original.revision,
     'sections',coalesce((SELECT jsonb_agg(jsonb_build_object(
       'id',s.id,'exerciseId',s.exercise_id,'name',s.exercise_name_snapshot,'type',s.record_type_snapshot,
       'sets',coalesce((SELECT jsonb_agg(jsonb_build_object(
         'id',t.id,'weight',t.weight_kg,'reps',t.reps,'seconds',t.duration_seconds,
         'performed',t.is_performed,'copied',t.is_copied
       ) ORDER BY t.position) FROM public.workout_sets t WHERE t.session_exercise_id=s.id AND t.user_id=actor),'[]'::jsonb)
     ) ORDER BY s.position) FROM public.session_exercises s WHERE s.session_id=original.id AND s.user_id=actor),'[]'::jsonb)
   ) INTO actual;
   -- Exact content comparison, not revision alone, reconciles a lost success response.
   IF actual=target THEN RETURN original.revision; END IF;
   IF original.status='completed' OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(expected) e WHERE e.value=actual) THEN
     RAISE EXCEPTION 'Remote snapshot changed; synchronization stopped' USING ERRCODE='PT409';
   END IF;
   IF (target->>'revision')::integer <= original.revision THEN
     RAISE EXCEPTION 'Revision must advance; synchronization stopped' USING ERRCODE='PT409';
   END IF;
 ELSE
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(expected) e WHERE e.value='null'::jsonb) THEN
     RAISE EXCEPTION 'Remote session deleted; synchronization stopped' USING ERRCODE='PT409';
   END IF;
   INSERT INTO public.sessions(id,user_id,name,started_at,ended_at,status,revision)
   VALUES(workout_id,actor,target->>'name',(target->>'startedAt')::timestamptz,NULL,'active',(target->>'revision')::integer);
 END IF;
 -- All child writes and publication occur in this transaction; any error rolls back all rows.
 DELETE FROM public.session_exercises s WHERE s.session_id=workout_id AND s.user_id=actor;
 section_position:=0;
 FOR section IN SELECT value FROM jsonb_array_elements(target->'sections') LOOP
   INSERT INTO public.session_exercises(id,user_id,session_id,exercise_id,exercise_name_snapshot,record_type_snapshot,position)
   VALUES((section->>'id')::uuid,actor,workout_id,(section->>'exerciseId')::uuid,section->>'name',section->>'type',section_position);
   set_position:=0;
   FOR item IN SELECT value FROM jsonb_array_elements(section->'sets') LOOP
     INSERT INTO public.workout_sets(id,user_id,session_exercise_id,record_type,position,weight_kg,reps,duration_seconds,is_performed,is_copied)
     VALUES((item->>'id')::uuid,actor,(section->>'id')::uuid,section->>'type',set_position,
       (item->>'weight')::numeric,(item->>'reps')::integer,(item->>'seconds')::integer,
       (item->>'performed')::boolean,(item->>'copied')::boolean);
     set_position:=set_position+1;
   END LOOP;
   section_position:=section_position+1;
 END LOOP;
 UPDATE public.sessions s SET name=target->>'name',started_at=(target->>'startedAt')::timestamptz,
   ended_at=(target->>'endedAt')::timestamptz,
   status=CASE WHEN target->>'endedAt' IS NULL THEN 'active' ELSE 'completed' END,
   revision=(target->>'revision')::integer
 WHERE s.id=workout_id AND s.user_id=actor;
 RETURN (target->>'revision')::integer;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_training_session(jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.sync_training_session(jsonb,jsonb) TO authenticated;
COMMENT ON FUNCTION public.sync_training_session(jsonb,jsonb) IS 'Owner-only atomic training synchronization; expected snapshots and exact idempotent replay; PT409 on conflict.';
NOTIFY pgrst,'reload schema';
COMMIT;
