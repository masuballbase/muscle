// Read-only browser export; all server fixture creation/deletion uses owner-scoped UUID journals.
// This scenario does NOT require or execute the proposed new synchronization RPC.
import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { loginClients } from "../../scripts/lib/test-clients.mjs";
import { Phase3Fixtures } from "../../scripts/lib/phase3-fixtures.mjs";
import { Phase4GoalFixtures } from "../../scripts/lib/phase4-goal-fixtures.mjs";
import { InBodyFixtures } from "../../scripts/lib/inbody-fixtures.mjs";
import { verifiedFields } from "../fixtures/inbody-verified";
import { TrainingRepository } from "../../src/lib/training/repository";
const fixtures = new Phase3Fixtures("/tmp/muscle-phase6-fixtures.json"),
  goals = new Phase4GoalFixtures("/tmp/muscle-phase6-goal-fixtures.json"),
  bodies = new InBodyFixtures("/tmp/muscle-phase6-inbody-fixtures.json");
async function login(page: Page, label: string) {
  await page.goto("/");
  await page.getByRole("button", { name: "ログイン", exact: true }).waitFor();
  await page.evaluate(
    ({ email, password }) => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      for (const [id, value] of [
        ["email", email],
        ["password", password],
      ]) {
        const input = document.getElementById(id) as HTMLInputElement;
        setter.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    },
    {
      email: process.env[`MUSCLE_TEST_${label}_EMAIL`]!,
      password: process.env[`MUSCLE_TEST_${label}_PASSWORD`]!,
    },
  );
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "自由に開始", exact: true }),
  ).toBeEnabled({ timeout: 20000 });
}
async function output(page: Page) {
  await page
    .getByRole("button", { name: "JSONエクスポート", exact: true })
    .click();
  const waiting = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "JSONファイルを出力", exact: true })
    .click();
  const path = await (await waiting).path();
  if (!path) throw new Error("Missing output");
  const value = JSON.parse(readFileSync(path, "utf8"));
  const text = JSON.stringify(value);
  for (const name of [
    "MUSCLE_TEST_A_EMAIL",
    "MUSCLE_TEST_A_PASSWORD",
    "MUSCLE_TEST_B_EMAIL",
    "MUSCLE_TEST_B_PASSWORD",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  ]) {
    const secret = process.env[name];
    if (secret && text.includes(secret))
      throw new Error("Sensitive value detected in output (redacted)");
  }
  return value;
}
test("Phase 6 live export: all 8 tables, pending equal-ID version, draft, offline confirmation and A/B cache isolation", async ({
  page,
  context,
}) => {
  test.setTimeout(240000);
  const accounts = await loginClients(),
    ids = new Map<string, Record<string, string>>();
  let offline = false;
  try {
    fixtures.requireEmpty();
    goals.requireEmpty();
    if (bodies.entries.length) throw new Error("Outstanding body fixtures");
    for (const a of accounts) {
      const x = {
        exercise: randomUUID(),
        menu: randomUUID(),
        item: randomUUID(),
        session: randomUUID(),
        section: randomUUID(),
        set: randomUUID(),
        body: randomUUID(),
        goal: "",
      };
      ids.set(a.label, x);
      for (const [table, row] of [
        [
          "exercises",
          {
            id: x.exercise,
            name: `phase6-${randomUUID()}`,
            record_type: "weight_reps",
          },
        ],
        ["menus", { id: x.menu, name: "Phase 6 fixture" }],
        [
          "menu_items",
          {
            id: x.item,
            menu_id: x.menu,
            exercise_id: x.exercise,
            position: 0,
            planned_sets: 1,
          },
        ],
        [
          "sessions",
          {
            id: x.session,
            name: "Phase 6 export fixture",
            started_at: new Date(Date.now() - 3600000).toISOString(),
            ended_at: new Date(Date.now() - 1800000).toISOString(),
            status: "completed",
            revision: 1,
          },
        ],
        [
          "session_exercises",
          {
            id: x.section,
            session_id: x.session,
            exercise_id: x.exercise,
            exercise_name_snapshot: "Phase 6 fixture",
            record_type_snapshot: "weight_reps",
            position: 0,
          },
        ],
        [
          "workout_sets",
          {
            id: x.set,
            session_exercise_id: x.section,
            record_type: "weight_reps",
            position: 0,
            weight_kg: 0,
            reps: 5,
            is_performed: true,
            is_copied: false,
          },
        ],
      ] as const) {
        await fixtures.reserve(a, table, row.id);
        const r = await a.client
          .from(table)
          .insert({ ...row, user_id: a.userId });
        if (r.error) throw new Error("Fixture insertion failed");
      }
      const date = new Date(
        Date.UTC(2450, 0, 1 + 7 * Math.floor(Math.random() * 10000)),
      );
      date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
      x.goal = await goals.create(a, date.toISOString().slice(0, 10));
      await bodies.reserve(a, x.body);
      const r = await a.client.from("inbody_records").insert({
        id: x.body,
        user_id: a.userId,
        measured_on: "2026-11-04",
        imported_at: new Date().toISOString(),
        source_filename: "phase6-generated.csv",
        raw_fields: verifiedFields(),
      });
      if (r.error) throw new Error("Body fixture insertion failed");
    }
    await context.route(
      "https://mcuiikilwrxuylwuljmk.supabase.co/**",
      async (route) => {
        const request = route.request(),
          url = new URL(request.url());
        try {
          if (
            url.pathname.startsWith("/rest/v1/") &&
            (offline || !["GET", "HEAD"].includes(request.method()))
          ) {
            await route.abort("internetdisconnected");
            return;
          }
          const headers = { ...request.headers() };
          delete headers.host;
          delete headers["content-length"];
          const response = await fetch(request.url(), {
            method: request.method(),
            headers,
            body: request.postData() ?? undefined,
          });
          const output = Object.fromEntries(response.headers.entries());
          delete output["content-length"];
          delete output["content-encoding"];
          await route.fulfill({
            status: response.status,
            headers: output,
            body: Buffer.from(await response.arrayBuffer()),
          });
        } catch {
          await route.abort("failed");
        }
      },
    );
    const a = accounts[0],
      x = ids.get(a.label)!;
    await login(page, a.label);
    const first = await output(page);
    expect(first.server.confirmation).toBe("fresh");
    expect(first.server.omittedColumns).toEqual(
      Object.fromEntries(
        Object.keys(first.server.omittedColumns).map((table) => [table, []]),
      ),
    );
    const tables = {
      exercises: "exercise",
      menus: "menu",
      menu_items: "item",
      sessions: "session",
      session_exercises: "section",
      workout_sets: "set",
      weekly_goal_schedule: "goal",
      inbody_records: "body",
    };
    for (const [table, key] of Object.entries(tables))
      expect(
        first.server.tables[table].some(
          (r: { id: string; user_id: string }) =>
            r.id === x[key] && r.user_id === a.userId,
        ),
      ).toBe(true);
    expect(
      first.server.tables.workout_sets.find(
        (r: { id: string }) => r.id === x.set,
      ).weight_kg,
    ).toBe(0);
    expect(
      Object.keys(
        first.server.tables.inbody_records.find(
          (r: { id: string }) => r.id === x.body,
        ).raw_fields,
      ),
    ).toHaveLength(44);
    await page
      .getByRole("button", { name: "JSONエクスポートを閉じる" })
      .click();
    const original = (
      await new TrainingRepository(a.client, a.userId).workouts()
    ).find((w) => w.id === x.session)!;
    await page.evaluate(
      async ({ user, original, menu, exercise }) => {
        const request = indexedDB.open(`muscle:user:${user}`, 2);
        const db = await new Promise<IDBDatabase>((resolve) => {
          request.onsuccess = () => resolve(request.result);
        });
        const tx = db.transaction(
          ["session_drafts", "menu_drafts"],
          "readwrite",
        );
        tx.objectStore("session_drafts").put({
          id: original.id,
          value: {
            ...original,
            name: "device-only pending",
            revision: original.revision + 1,
          },
          updatedAt: new Date().toISOString(),
        });
        tx.objectStore("menu_drafts").put({
          id: menu,
          value: {
            version: 1,
            id: menu,
            name: "device-only draft",
            items: [
              { id: "draft-item", exerciseId: exercise, plannedSets: "3" },
            ],
            base: null,
          },
          updatedAt: new Date().toISOString(),
        });
        await new Promise<void>((resolve) => {
          tx.oncomplete = () => resolve();
        });
        db.close();
      },
      { user: a.userId, original, menu: x.menu, exercise: x.exercise },
    );
    offline = true;
    await page.reload();
    await expect(
      page.getByRole("button", { name: "JSONエクスポート", exact: true }),
    ).toBeVisible();
    const second = await output(page);
    expect(second.server.confirmation).toBe("cached");
    expect(
      second.server.tables.sessions.find(
        (r: { id: string }) => r.id === x.session,
      ).revision,
    ).toBe(1);
    expect(
      second.device.sessions.find(
        (r: { value: { id: string } }) => r.value.id === x.session,
      ).value.revision,
    ).toBe(2);
    expect(
      second.device.menuDrafts.some(
        (r: { value: { id: string } }) => r.value.id === x.menu,
      ),
    ).toBe(true);
    await page
      .getByRole("button", { name: "JSONエクスポートを閉じる" })
      .click();
    offline = false;
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "ログアウト", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "ログイン", exact: true }),
    ).toBeVisible();
    await login(page, accounts[1].label);
    const b = await output(page);
    expect(b.userId).toBe(accounts[1].userId);
    expect(b.device.sessions).toHaveLength(0);
    expect(b.device.menuDrafts).toHaveLength(0);
    for (const [table, key] of Object.entries(tables))
      expect(
        b.server.tables[table].some((r: { id: string }) => r.id === x[key]),
      ).toBe(false);
  } finally {
    await context.close();
    const body = await bodies.cleanup(accounts),
      goal = await goals.cleanup(accounts),
      training = await fixtures.cleanup(accounts);
    for (const a of accounts) await a.client.auth.signOut({ scope: "local" });
    expect(body + goal + training).toBe(0);
  }
});
