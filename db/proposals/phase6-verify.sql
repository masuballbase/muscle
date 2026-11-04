-- READ ONLY: catalog audit after the separately approved SQL application.
SELECT n.nspname AS schema_name,p.proname,pg_get_function_identity_arguments(p.oid) AS arguments,
 p.prosecdef AS security_definer,p.proconfig AS settings,
 has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_execute,
 has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute,
 EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS public_execute
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN ('sync_training_session','save_training_menu','edit_training_history','archive_training_exercise')
ORDER BY p.proname;
SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity,count(p.policyname) AS policy_count
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
LEFT JOIN pg_policies p ON p.schemaname=n.nspname AND p.tablename=c.relname
WHERE n.nspname='public' AND c.relname IN ('exercises','menus','menu_items','sessions','session_exercises','workout_sets','weekly_goal_schedule','inbody_records')
GROUP BY c.oid,c.relname,c.relrowsecurity,c.relforcerowsecurity ORDER BY c.relname;
