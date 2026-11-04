import { it, expect, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import type { SupabaseClient } from "@supabase/supabase-js";
import { openUserStore } from "../local-store";
import { ExportService } from "./service";
import { columns, type Table, type Tables } from "./model";
import { newWorkout } from "../training/model";
import { draftOf } from "../menus/model";
import { verifiedFields } from "../../../tests/fixtures/inbody-verified";
function setup() {
  let fail = false,
    user = "A",
    flipDuringRead = false;
  const tables = Object.fromEntries(
    Object.keys(columns).map((t) => [t, []]),
  ) as unknown as Tables;
  for (const t of Object.keys(columns) as Table[])
    tables[t] = [
      {
        id: t,
        user_id: "A",
        ...(t === "inbody_records" ? { raw_fields: verifiedFields() } : {}),
        ...(t === "exercises" ? { used_at: "2026-11-04T00:00:00Z" } : {}),
        password: "SECRET_PASSWORD",
        access_token: "SECRET_TOKEN",
      },
    ];
  const client = {
    auth: {
      getSession: vi.fn(async () => ({
        data: { session: { user: { id: user } } },
        error: null,
      })),
    },
    from: vi.fn((table: Table) => {
      let start = 0,
        end = 499;
      const chain = {
        select: vi.fn(),
        eq: vi.fn(),
        order: vi.fn(),
        range: vi.fn((a: number, b: number) => {
          start = a;
          end = b;
          return chain;
        }),
        abortSignal: vi.fn(async () => {
          if (flipDuringRead) {
            user = "B";
            flipDuringRead = false;
          }
          return {
            data: fail ? null : tables[table].slice(start, end + 1),
            error: fail ? { code: "OFFLINE" } : null,
          };
        }),
      };
      chain.select.mockReturnValue(chain);
      chain.eq.mockReturnValue(chain);
      chain.order.mockReturnValue(chain);
      return chain;
    }),
  } as unknown as SupabaseClient;
  return {
    client,
    tables,
    switchWhileReading: () => {
      flipDuringRead = true;
    },
    offline: () => {
      fail = true;
    },
    changeUser: (id: string) => {
      user = id;
    },
  };
}
it("exports all eight tables plus device changes/drafts separately, preserving equal IDs and excluding auth/unknown properties", async () => {
  const { client, tables } = setup(),
    store = await openUserStore("A", new IDBFactory());
  const w = newWorkout();
  w.id = "sessions";
  w.revision = 2;
  w.syncedRevision = 1;
  await store.put("session_drafts", w.id, { ...w, password: "SECRET_LOCAL" });
  await store.put("menu_drafts", "menus", {
    ...draftOf({ id: "menus", name: "draft", items: [] }),
    access_token: "SECRET_DRAFT",
  });
  tables.sessions = [
    { id: "sessions", user_id: "A", revision: 1, status: "active" },
  ];
  const result = await new ExportService(client, store, "A").create();
  expect(Object.keys(result.server.tables!)).toHaveLength(8);
  expect(result.server.tables!.sessions[0].revision).toBe(1);
  expect(result.device.sessions[0].value.revision).toBe(2);
  expect(result.device.sessions[0].value.id).toBe("sessions");
  expect(result.device.menuDrafts[0].value.id).toBe("menus");
  const text = JSON.stringify(result);
  for (const secret of [
    "SECRET_PASSWORD",
    "SECRET_TOKEN",
    "SECRET_LOCAL",
    "SECRET_DRAFT",
  ])
    expect(text).not.toContain(secret);
  expect(result.server.tables!.inbody_records[0].raw_fields).toEqual(
    verifiedFields(),
  );
  expect(result.server.tables!.exercises[0].used_at).toBe(
    "2026-11-04T00:00:00Z",
  );
  expect(result.schemaVersion).toBe("muscle-data-export/1");
  expect(result.server.confirmation).toBe("fresh");
  store.close();
});
it("distinguishes offline cached server data from fresh data, keeps local changes and warns about volatile input", async () => {
  const s = setup(),
    store = await openUserStore("A", new IDBFactory()),
    service = new ExportService(s.client, store, "A");
  const first = await service.create();
  s.offline();
  await store.put("session_drafts", "pending", newWorkout());
  const output = await service.create({ volatileInputAtRisk: true });
  expect(output.server.confirmation).toBe("cached");
  expect(output.server.lastConfirmedAt).toBe(first.server.lastConfirmedAt);
  expect(output.server.omittedColumns).toEqual(first.server.omittedColumns);
  expect(output.device.sessions).toHaveLength(1);
  expect(output.device.volatileInputAtRisk).toBe(true);
  expect(output.warnings.some((w) => w.includes("保証できません"))).toBe(true);
  store.close();
});
it("does not misrepresent missing offline server data as empty or current", async () => {
  const s = setup();
  s.offline();
  const store = await openUserStore("A", new IDBFactory());
  const output = await new ExportService(s.client, store, "A").create();
  expect(output.server.confirmation).toBe("unavailable");
  expect(output.server.tables).toBeNull();
  expect(output.counts.server).toBeNull();
  expect(output.server.lastConfirmedAt).toBeNull();
  store.close();
});
it("refuses cross-account rows/store/cache and account switches during export", async () => {
  const s = setup(),
    factory = new IDBFactory(),
    a = await openUserStore("A", factory),
    b = await openUserStore("B", factory);
  await expect(new ExportService(s.client, b, "A").create()).rejects.toThrow(
    "端末ユーザー",
  );
  s.changeUser("B");
  await expect(new ExportService(s.client, a, "A").create()).rejects.toThrow(
    "ログイン",
  );
  s.changeUser("A");
  s.tables.exercises[0].user_id = "B";
  s.offline();
  await a.put("cache", "data-export", {
    version: 1,
    userId: "A",
    confirmedAt: new Date().toISOString(),
    tables: s.tables,
  });
  await expect(new ExportService(s.client, a, "A").create()).rejects.toThrow(
    "一致",
  );
  a.close();
  b.close();
});
it("paginates beyond 1000 rows and preserves null/zero and session/set relationships", async () => {
  const s = setup(),
    store = await openUserStore("A", new IDBFactory());
  s.tables.workout_sets = Array.from({ length: 1501 }, (_, i) => ({
    id: String(i),
    user_id: "A",
    session_exercise_id: "section",
    weight_kg: 0,
    reps: null,
  }));
  const output = await new ExportService(s.client, store, "A").create();
  expect(output.server.tables!.workout_sets).toHaveLength(1501);
  expect(output.server.tables!.workout_sets[0]).toMatchObject({
    session_exercise_id: "section",
    weight_kg: 0,
    reps: null,
  });
  store.close();
});
it("does not silently discard unreadable device data or opaque queues", async () => {
  const s = setup(),
    store = await openUserStore("A", new IDBFactory());
  await store.put("sync_queue", "unknown", { access_token: "DO_NOT_EXPORT" });
  await expect(
    new ExportService(s.client, store, "A").create(),
  ).rejects.toThrow("未対応");
  await store.remove("sync_queue", "unknown");
  await store.put("menu_drafts", "missing", { name: "draft without version" });
  await expect(
    new ExportService(s.client, store, "A").create(),
  ).rejects.toThrow("形式");
  store.close();
});

it("preserves incomplete raw InBody data as-is and explicitly reports missing fields rather than inventing 44 values", async () => {
  const s = setup(),
    store = await openUserStore("A", new IDBFactory());
  s.tables.inbody_records[0].raw_fields = { "体重(kg)": null };
  const output = await new ExportService(s.client, store, "A").create();
  expect(output.server.tables!.inbody_records[0].raw_fields).toEqual({
    "体重(kg)": null,
  });
  expect(output.counts.incompleteInBodyRecords).toBe(1);
  expect(output.warnings.some((w) => w.includes("欠損を補完せず"))).toBe(true);
  store.close();
});

it("aborts instead of falling back to account A cache if auth changes during server reads", async () => {
  const s = setup(),
    store = await openUserStore("A", new IDBFactory()),
    service = new ExportService(s.client, store, "A");
  await service.create();
  s.switchWhileReading();
  await expect(service.create()).rejects.toThrow("ログインユーザー");
  store.close();
});
