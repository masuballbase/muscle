import { IDBFactory } from "fake-indexeddb";
import { describe, it, expect, vi } from "vitest";
import { openUserStore } from "./local-store";

describe("account-scoped IndexedDB", () => {
  it("retains drafts across reopen and isolates accounts", async () => {
    const factory = new IDBFactory();
    const a = await openUserStore("a", factory);
    await a.put("session_drafts", "same-id", { name: "private draft" });
    a.close();
    const reopened = await openUserStore("a", factory);
    const b = await openUserStore("b", factory);
    expect(
      (await reopened.get<{ name: string }>("session_drafts", "same-id"))?.value
        .name,
    ).toBe("private draft");
    expect(await b.get("session_drafts", "same-id")).toBeUndefined();
    expect(await reopened.pendingCount()).toBe(1);
    await reopened.remove("session_drafts", "same-id");
    expect(await reopened.pendingCount()).toBe(0);
    reopened.close();
    b.close();
  });
  it("upserts stable IDs and keeps menu drafts independent", async () => {
    const db = await openUserStore("a", new IDBFactory());
    await db.put("sync_queue", "stable", { version: 1 });
    await db.put("sync_queue", "stable", { version: 2 });
    expect(await db.list("sync_queue")).toHaveLength(1);
    await db.put("menu_drafts", "one", { name: "one" });
    await db.put("menu_drafts", "two", { name: "two" });
    await db.remove("menu_drafts", "one");
    expect(await db.list("menu_drafts")).toHaveLength(1);
    expect(await db.pendingCount()).toBe(2);
    db.close();
  });
  it("rejects missing identity and unavailable storage", async () => {
    await expect(openUserStore("", new IDBFactory())).rejects.toThrow();
    const db = await openUserStore("a", new IDBFactory());
    db.close();
    await expect(db.put("session_drafts", "one", {})).rejects.toThrow();
  });
});

it("handles browsers without IndexedDB as a recoverable failure", async () => {
  vi.stubGlobal("indexedDB", undefined);
  try {
    await expect(openUserStore("a")).rejects.toThrow(
      "端末保存を利用できません。",
    );
  } finally {
    vi.unstubAllGlobals();
  }
});
