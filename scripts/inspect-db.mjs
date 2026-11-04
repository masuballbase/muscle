import { createClient } from "@supabase/supabase-js";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (
  !url ||
  !key ||
  new URL(url).hostname !== "mcuiikilwrxuylwuljmk.supabase.co"
)
  throw new Error("Expected project configuration required");
const client = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const columns = {
  exercises: [
    "id",
    "user_id",
    "name",
    "name_normalized",
    "record_type",
    "archived_at",
  ],
  menus: ["id", "user_id", "name"],
  menu_items: ["menu_id", "exercise_id", "position", "planned_sets"],
  sessions: ["id", "user_id", "name", "started_at", "ended_at", "status"],
  session_exercises: [
    "id",
    "session_id",
    "exercise_id",
    "exercise_name_snapshot",
    "record_type_snapshot",
    "position",
  ],
  workout_sets: [
    "id",
    "session_exercise_id",
    "position",
    "weight_kg",
    "reps",
    "duration_seconds",
    "is_performed",
  ],
  weekly_goal_schedule: ["user_id", "effective_monday", "target_days"],
  inbody_records: [
    "id",
    "user_id",
    "measured_on",
    "imported_at",
    "source_filename",
    "raw_fields",
  ],
};
let failed = false;
try {
  const { error } = await client.auth.signInWithPassword({
    email: process.env.MUSCLE_TEST_A_EMAIL,
    password: process.env.MUSCLE_TEST_A_PASSWORD,
  });
  if (error) throw new Error("Schema inspection authentication failed");
  for (const [table, names] of Object.entries(columns)) {
    for (const column of names) {
      const { error } = await client.from(table).select(column).limit(0);
      console.log(
        `${table}.${column}: ${error ? `unconfirmed (${error.code})` : "available"}`,
      );
      if (error) failed = true;
    }
  }
  const optional = await client.from("menus").select("needs_fix").limit(0);
  console.log(
    `menus.needs_fix (recommended only, unused in Phase 1): ${optional.error ? "not available" : "available"}`,
  );
  console.log(
    "Read-only column compatibility check. Types, constraints and policy definitions require catalog access; no SQL executed.",
  );
} finally {
  await client.auth.signOut({ scope: "local" });
}
process.exitCode = failed ? 1 : 0;
