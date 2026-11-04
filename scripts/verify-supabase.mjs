import { createClient } from "@supabase/supabase-js";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (
  !url ||
  !key ||
  new URL(url).hostname !== "mcuiikilwrxuylwuljmk.supabase.co"
)
  throw new Error("Expected project configuration required");
const tables = [
  "exercises",
  "menus",
  "menu_items",
  "sessions",
  "session_exercises",
  "workout_sets",
  "weekly_goal_schedule",
  "inbody_records",
];
const clients = [];
let failed = false;
try {
  for (const account of ["A", "B"]) {
    const email = process.env[`MUSCLE_TEST_${account}_EMAIL`];
    const password = process.env[`MUSCLE_TEST_${account}_PASSWORD`];
    if (!email || !password) {
      console.log(`Account ${account}: configuration unavailable`);
      failed = true;
      continue;
    }
    const client = createClient(url, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
    const { data, error } = await client.auth.signInWithPassword({
      email,
      password,
    });
    if (error || !data.user) {
      console.log(
        `Account ${account}: authentication failed (HTTP ${error?.status ?? "unknown"})`,
      );
      failed = true;
      continue;
    }
    clients.push(client);
    client.testUserId = data.user.id;
    console.log(`Account ${account}: authenticated`);
    for (const table of tables) {
      const result = await client.from(table).select("*").limit(1);
      console.log(
        `${account}/${table}: ${result.error ? "read failed" : "read succeeded"}`,
      );
      if (result.error) failed = true;
      // Never print rows, user IDs or tokens.
      if (
        !result.error &&
        result.data.some((row) => row.user_id && row.user_id !== data.user.id)
      ) {
        failed = true;
        console.log(`${account}/${table}: ownership check failed`);
      }
    }
  }
  const ownedTables = [
    "exercises",
    "menus",
    "sessions",
    "weekly_goal_schedule",
    "inbody_records",
  ];
  if (clients.length === 2) {
    if (clients[0].testUserId === clients[1].testUserId) {
      failed = true;
      console.log("Accounts must be distinct");
    }
    for (let index = 0; index < clients.length; index++) {
      for (const table of ownedTables) {
        const result = await clients[index]
          .from(table)
          .select("user_id")
          .eq("user_id", clients[1 - index].testUserId)
          .limit(1);
        const safe = !result.error && result.data.length === 0;
        if (!safe) failed = true;
        console.log(
          `${index === 0 ? "A" : "B"}/${table}: other-account read ${safe ? "returned no rows" : "FAILED"}`,
        );
      }
    }
  }
  const anonymous = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  for (const table of tables) {
    const result = await anonymous.from(table).select("*").limit(1);
    const safe =
      result.error?.code === "42501" ||
      (!result.error && result.data.length === 0);
    if (!safe) failed = true;
    console.log(
      `Anonymous/${table}: ${safe ? "no rows accessible" : "FAILED"}`,
    );
  }
  console.log(
    "No database writes performed. Empty reads do not prove RLS; write-policy testing requires isolated fixtures and a confirmed schema.",
  );
} finally {
  for (const client of clients) await client.auth.signOut({ scope: "local" });
}
process.exitCode = failed ? 1 : 0;
