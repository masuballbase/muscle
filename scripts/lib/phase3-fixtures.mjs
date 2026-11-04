import { existsSync, readFileSync, writeFileSync } from "node:fs";
const tables = [
  "workout_sets",
  "session_exercises",
  "sessions",
  "menu_items",
  "menus",
  "exercises",
];
export class Phase3Fixtures {
  constructor(path = "/tmp/muscle-phase3-fixtures.json") {
    this.path = path;
    this.entries = existsSync(path)
      ? JSON.parse(readFileSync(path, "utf8"))
      : [];
    if (
      !Array.isArray(this.entries) ||
      this.entries.some(
        (e) =>
          !["A", "B"].includes(e.account) ||
          !tables.includes(e.table) ||
          !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(e.id),
      )
    )
      throw new Error("Invalid fixture journal");
  }
  requireEmpty() {
    if (this.entries.length)
      throw new Error(
        "Outstanding Phase 3 fixtures: run verify:phase3:cleanup first",
      );
  }
  save() {
    writeFileSync(this.path, JSON.stringify(this.entries), { mode: 0o600 });
  }
  has(account, table, id) {
    return this.entries.some(
      (e) => e.account === account && e.table === table && e.id === id,
    );
  }
  async reserve(account, table, id) {
    if (this.has(account.label, table, id)) return;
    if (!tables.includes(table) || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id))
      throw new Error("Invalid fixture identity");
    const { data, error } = await account.client
      .from(table)
      .select("id")
      .eq("user_id", account.userId)
      .eq("id", id);
    if (error || data.length)
      throw new Error(
        "Fixture preflight failed; refusing to touch existing rows",
      );
    this.entries.push({ account: account.label, table, id });
    this.save();
  }
  async cleanup(accounts) {
    for (const table of tables)
      for (const entry of this.entries.filter((e) => e.table === table)) {
        const account = accounts.find((a) => a.label === entry.account);
        if (!account) continue;
        const removed = await account.client
          .from(table)
          .delete()
          .eq("id", entry.id)
          .eq("user_id", account.userId);
        if (removed.error) continue;
        const remaining = await account.client
          .from(table)
          .select("id")
          .eq("id", entry.id)
          .eq("user_id", account.userId);
        if (remaining.error || remaining.data.length) continue;
        this.entries = this.entries.filter((e) => e !== entry);
        this.save();
      }
    return this.entries.length;
  }
}
