// Recovery for interrupted Phase 2 browser tests. Deletes only journaled UUIDs.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { loginClients } from "./lib/test-clients.mjs";
const path = "/tmp/muscle-phase2-browser-fixtures.json";
let journal = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : [];
const tables = ["workout_sets", "session_exercises", "sessions", "exercises"];
if (
  !Array.isArray(journal) ||
  journal.some(
    (entry) =>
      !["A", "B"].includes(entry.account) ||
      !tables.includes(entry.table) ||
      !/^[0-9a-f-]{36}$/i.test(entry.id),
  )
)
  throw new Error("Invalid fixture journal; refusing cleanup");
const accounts = await loginClients();
try {
  for (const table of tables)
    for (const entry of journal.filter((e) => e.table === table)) {
      const account = accounts.find((a) => a.label === entry.account);
      const removed = await account.client
        .from(table)
        .delete()
        .eq("user_id", account.userId)
        .eq("id", entry.id);
      if (removed.error) throw new Error(`Fixture cleanup failed: ${table}`);
      const remaining = await account.client
        .from(table)
        .select("id")
        .eq("user_id", account.userId)
        .eq("id", entry.id);
      if (remaining.error || remaining.data.length)
        throw new Error("Fixture remains");
      journal = journal.filter((e) => e !== entry);
      writeFileSync(path, JSON.stringify(journal), { mode: 0o600 });
    }
  console.log(`Remaining Phase 2 fixture entries: ${journal.length}`);
} finally {
  for (const account of accounts)
    await account.client.auth.signOut({ scope: "local" });
}
