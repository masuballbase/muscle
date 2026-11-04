-- READ ONLY: no DDL, RPC execution, cancellation, termination, reload or restart.
-- Run each SELECT separately in SQL Editor for project mcuiikilwrxuylwuljmk.
-- Retake activity/counter SELECTs 2-3 times, 5-10 seconds apart, WITHOUT rerunning RPC tests.
-- Do not share JWTs, request headers, bind values, or unrelated users' query text.

-- 1. Observation context; verify the project reference in the SQL Editor UI as well.
SELECT clock_timestamp() AS observed_at, current_database() AS database_name,
       current_user AS observer_role, pg_is_in_recovery() AS is_replica;

-- 2. Identify every overload/schema. A successful COMMIT alone does not prove replacement.
SELECT clock_timestamp() AS observed_at, n.nspname AS schema_name, p.oid,
       p.proname AS function_name, pg_get_function_identity_arguments(p.oid) AS arguments,
       p.prosecdef AS security_definer, p.proconfig AS settings,
       strpos(upper(p.prosrc), 'PT409') > 0 AS has_pt409,
       strpos(p.prosrc, '40001') > 0 AS has_40001,
       md5(p.prosrc) AS body_fingerprint
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.proname IN ('save_training_menu','edit_training_history')
ORDER BY n.nspname, p.proname, arguments;

-- 3. Read the definitions; this does NOT invoke either function.
SELECT n.nspname AS schema_name, p.oid,
       pg_get_function_identity_arguments(p.oid) AS arguments,
       pg_get_functiondef(p.oid) AS function_definition
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.proname IN ('save_training_menu','edit_training_history')
ORDER BY n.nspname, p.proname, arguments;

-- 4. Active/aborted transactions and API backends, including short repeated transactions.
-- Return fingerprints and booleans rather than query bodies or request payloads.
SELECT clock_timestamp() AS observed_at, pid, backend_type, usename, application_name,
       state, backend_start, xact_start, query_start, state_change,
       clock_timestamp() - xact_start AS transaction_age,
       clock_timestamp() - query_start AS query_age,
       wait_event_type, wait_event, pg_blocking_pids(pid) AS blocking_pids,
       query IS NULL OR query = '<insufficient privilege>' AS query_hidden,
       md5(query) AS query_fingerprint,
       query ILIKE '%save_training_menu%' AS mentions_menu_rpc,
       query ILIKE '%edit_training_history%' AS mentions_history_rpc,
       query ILIKE '%40001%' AS query_text_mentions_40001
FROM pg_stat_activity
WHERE datname = current_database() AND pid <> pg_backend_pid()
  AND (state IS DISTINCT FROM 'idle'
       OR application_name ILIKE '%postgrest%'
       OR query ILIKE '%save_training_menu%'
       OR query ILIKE '%edit_training_history%')
ORDER BY xact_start NULLS LAST, query_start NULLS LAST
LIMIT 100;

-- 5. Blocking relationships, including blockers whose latest query is not the RPC.
SELECT clock_timestamp() AS observed_at,
       waiting.pid AS waiting_pid, waiting.application_name AS waiting_application,
       waiting.state AS waiting_state, waiting.wait_event_type, waiting.wait_event,
       waiting.xact_start AS waiting_xact_start, waiting.query_start AS waiting_query_start,
       blocker.pid AS blocking_pid, blocker.application_name AS blocking_application,
       blocker.state AS blocking_state, blocker.xact_start AS blocking_xact_start,
       blocker.query_start AS blocking_query_start
FROM pg_stat_activity waiting
CROSS JOIN LATERAL unnest(pg_blocking_pids(waiting.pid)) blocked_by(pid)
JOIN pg_stat_activity blocker ON blocker.pid = blocked_by.pid
WHERE waiting.datname = current_database() AND waiting.pid <> pg_backend_pid()
ORDER BY waiting.xact_start NULLS LAST;

-- 6. Database-wide evidence only. A delta is NOT proof of RPC-specific retries by itself.
SELECT clock_timestamp() AS observed_at, datname, xact_commit, xact_rollback,
       deadlocks, conflicts, numbackends, stats_reset
FROM pg_stat_database WHERE datname = current_database();
