-- Read-only verification after the approved RPC proposal has been applied.
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS arguments,
       p.prosecdef AS security_definer, p.proconfig AS configuration,
       has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_execute,
       has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute,
       EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) AS a
               WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS public_execute
FROM pg_proc AS p JOIN pg_namespace AS n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN
 ('save_training_menu','edit_training_history','archive_training_exercise')
ORDER BY p.proname;
-- Expected: exactly 3 signatures, security_definer=false, search_path=pg_catalog,
-- authenticated_execute=true, anon_execute=false, public_execute=false.
SELECT c.relname AS table_name,c.relrowsecurity AS rls_enabled,c.relforcerowsecurity AS force_rls,
       count(p.policyname) AS policy_count
FROM pg_class AS c JOIN pg_namespace AS n ON n.oid=c.relnamespace
LEFT JOIN pg_policies AS p ON p.schemaname=n.nspname AND p.tablename=c.relname
WHERE n.nspname='public' AND c.relname IN ('exercises','menus','menu_items','sessions',
 'session_exercises','workout_sets','weekly_goal_schedule','inbody_records')
GROUP BY c.oid,c.relname,c.relrowsecurity,c.relforcerowsecurity
ORDER BY c.relname;
