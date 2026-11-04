import { existsSync, readFileSync, writeFileSync } from "node:fs";
export class InBodyFixtures {
  constructor(path = "/tmp/muscle-phase5-fixtures.json") {
    this.path = path;
    this.entries = existsSync(path)
      ? JSON.parse(readFileSync(path, "utf8"))
      : [];
    if (
      !Array.isArray(this.entries) ||
      this.entries.some(
        (e) =>
          !["A", "B"].includes(e.account) ||
          !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(e.id),
      )
    )
      throw new Error("Invalid InBody fixture journal");
  }
  save() {
    writeFileSync(this.path, JSON.stringify(this.entries), { mode: 0o600 });
  }
  requireEmpty() {
    if (this.entries.length)
      throw new Error("Outstanding InBody fixtures: run cleanup");
  }
  has(account, id) {
    return this.entries.some((e) => e.account === account && e.id === id);
  }
  async reserve(account, id) {
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id))
      throw new Error("Invalid fixture UUID");
    if (this.has(account.label, id)) return;
    const found = await account.client
      .from("inbody_records")
      .select("id")
      .eq("user_id", account.userId)
      .eq("id", id);
    if (found.error || found.data.length)
      throw new Error("Refusing an existing measurement");
    this.entries.push({ account: account.label, id });
    this.save();
  }
  async cleanup(accounts) {
    for (const entry of [...this.entries]) {
      const a = accounts.find((a) => a.label === entry.account);
      if (!a) continue;
      const removed = await a.client
        .from("inbody_records")
        .delete()
        .eq("id", entry.id)
        .eq("user_id", a.userId);
      if (removed.error) continue;
      const found = await a.client
        .from("inbody_records")
        .select("id")
        .eq("id", entry.id)
        .eq("user_id", a.userId);
      if (found.error || found.data.length) continue;
      this.entries = this.entries.filter((e) => e !== entry);
      this.save();
    }
    return this.entries.length;
  }
}
