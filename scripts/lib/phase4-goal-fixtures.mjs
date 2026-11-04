// Dedicated known IDs only. No pre-existing goal or schedule is ever overwritten.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
export class Phase4GoalFixtures {
  constructor(path = "/tmp/muscle-phase4-goal-fixtures.json") {
    this.path = path;
    this.entries = existsSync(path)
      ? JSON.parse(readFileSync(path, "utf8"))
      : [];
    if (
      !Array.isArray(this.entries) ||
      this.entries.some(
        (e) =>
          !["A", "B"].includes(e.account) ||
          !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(e.id) ||
          !/^\d{4}-\d{2}-\d{2}$/.test(e.monday),
      )
    )
      throw new Error("Invalid goal fixture journal");
  }
  save() {
    writeFileSync(this.path, JSON.stringify(this.entries), { mode: 0o600 });
  }
  requireEmpty() {
    if (this.entries.length)
      throw new Error("Outstanding Phase 4 goal fixtures: run cleanup");
  }
  async create(account, monday) {
    const found = await account.client
      .from("weekly_goal_schedule")
      .select("id")
      .eq("user_id", account.userId)
      .eq("effective_monday", monday);
    if (found.error || found.data.length)
      throw new Error(
        "Goal preflight refused: existing schedule must be preserved",
      );
    const id = randomUUID();
    const preflight = await account.client
      .from("weekly_goal_schedule")
      .select("id")
      .eq("id", id)
      .eq("user_id", account.userId);
    if (preflight.error || preflight.data.length)
      throw new Error("Goal ID preflight refused");
    this.entries.push({ account: account.label, id, monday });
    this.save();
    const inserted = await account.client
      .from("weekly_goal_schedule")
      .insert({
        id,
        user_id: account.userId,
        effective_monday: monday,
        target_days: 3,
      });
    if (inserted.error) throw new Error("Goal fixture insert failed");
    return id;
  }
  has(account, id, monday) {
    return this.entries.some(
      (e) => e.account === account && e.id === id && e.monday === monday,
    );
  }
  async cleanup(accounts) {
    for (const entry of [...this.entries]) {
      const account = accounts.find((a) => a.label === entry.account);
      if (!account) continue;
      const query = () => account.client.from("weekly_goal_schedule");
      const removed = await query()
        .delete()
        .eq("user_id", account.userId)
        .eq("id", entry.id)
        .eq("effective_monday", entry.monday);
      if (removed.error) continue;
      const remaining = await query()
        .select("id")
        .eq("user_id", account.userId)
        .eq("id", entry.id);
      if (remaining.error || remaining.data.length) continue;
      const byKey = await query()
        .select("id")
        .eq("user_id", account.userId)
        .eq("effective_monday", entry.monday);
      if (byKey.error || byKey.data.length) continue;
      this.entries = this.entries.filter((e) => e !== entry);
      this.save();
    }
    return this.entries.length;
  }
}
