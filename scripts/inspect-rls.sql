-- READ ONLY. Run only in an already authorized project SQL editor/connection.
-- No functions, policies, tables, grants or schema are created or changed.
BEGIN TRANSACTION READ ONLY;

SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS force_rls, pg_get_userbyid(c.relowner) AS table_owner,
       count(p.policyname) AS policy_count,
       array_agg(DISTINCT p.cmd ORDER BY p.cmd) AS policy_commands
FROM pg_class AS c
JOIN pg_namespace AS n ON n.oid = c.relnamespace
LEFT JOIN pg_policies AS p ON p.schemaname = n.nspname AND p.tablename = c.relname
WHERE n.nspname = 'public' AND c.relname IN (
 'exercises','menus','menu_items','sessions','session_exercises',
 'workout_sets','weekly_goal_schedule','inbody_records')
GROUP BY c.oid, c.relname, c.relrowsecurity, c.relforcerowsecurity, c.relowner
ORDER BY c.relname;

SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename IN (
 'exercises','menus','menu_items','sessions','session_exercises',
 'workout_sets','weekly_goal_schedule','inbody_records')
ORDER BY tablename, cmd, policyname;

SELECT rolname, rolsuper, rolbypassrls, rolinherit
FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'authenticator');

SELECT table_name, grantee, privilege_type
FROM information_schema.table_privileges
WHERE table_schema = 'public' AND grantee IN ('anon','authenticated','PUBLIC')
 AND table_name IN ('exercises','menus','menu_items','sessions','session_exercises',
 'workout_sets','weekly_goal_schedule','inbody_records')
ORDER BY table_name, grantee, privilege_type;

-- Check ownership FKs, generated columns and type/check constraints as well.
SELECT c.relname AS table_name, con.conname, con.contype,
       pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint AS con
JOIN pg_class AS c ON c.oid = con.conrelid
JOIN pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname IN (
 'exercises','menus','menu_items','sessions','session_exercises',
 'workout_sets','weekly_goal_schedule','inbody_records')
ORDER BY c.relname, con.conname;

ROLLBACK;
