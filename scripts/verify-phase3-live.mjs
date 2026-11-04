// Dedicated UUID fixtures only. Never changes schema/RLS or executes DDL.
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { loginClients, makeClient } from "./lib/test-clients.mjs";
import { Phase3Fixtures } from "./lib/phase3-fixtures.mjs";
const fixtures = new Phase3Fixtures(
  process.argv.includes("--browser-cleanup")
    ? "/tmp/muscle-phase3-browser-fixtures.json"
    : undefined,
);
const accounts = await loginClients();
const anonymous = makeClient();
const results = [];
function check(label, pass, code) {
  results.push({ label, pass, ...(code ? { code } : {}) });
  console.log(`${pass ? "PASS" : "FAIL"} ${label}${code ? ` (${code})` : ""}`);
}
function required(result, label) {
  if (result.error)
    throw new Error(`${label} (${result.error.code ?? "network"})`);
  return result.data;
}
async function create(account, table, row) {
  await fixtures.reserve(account, table, row.id);
  required(
    await account.client
      .from(table)
      .insert({ ...row, user_id: account.userId })
      .select("id"),
    `${table} fixture create`,
  );
}
async function menuSnapshot(a, id) {
  return {
    menu: required(
      await a.client
        .from("menus")
        .select("*")
        .eq("user_id", a.userId)
        .eq("id", id),
      "menu read",
    ),
    items: required(
      await a.client
        .from("menu_items")
        .select("*")
        .eq("user_id", a.userId)
        .eq("menu_id", id)
        .order("id"),
      "menu items read",
    ),
  };
}
async function historySnapshot(a, id) {
  const sections = required(
    await a.client
      .from("session_exercises")
      .select("*")
      .eq("user_id", a.userId)
      .eq("session_id", id)
      .order("id"),
    "section read",
  );
  return {
    parent: required(
      await a.client
        .from("sessions")
        .select("*")
        .eq("user_id", a.userId)
        .eq("id", id),
      "history read",
    ),
    sections,
    sets: sections.length
      ? required(
          await a.client
            .from("workout_sets")
            .select("*")
            .eq("user_id", a.userId)
            .in(
              "session_exercise_id",
              sections.map((s) => s.id),
            )
            .order("id"),
          "set read",
        )
      : [],
  };
}
try {
  if (!process.argv.includes("--cleanup")) {
    fixtures.requireEmpty();
    const groups = [];
    for (const a of accounts) {
      const marker = `phase3-live-${randomUUID()}`;
      const ids = {
        e: randomUUID(),
        e2: randomUUID(),
        menu: randomUUID(),
        item: randomUUID(),
        item2: randomUUID(),
        session: randomUUID(),
        section: randomUUID(),
        set: randomUUID(),
        badSet: randomUUID(),
      };
      await create(a, "exercises", {
        id: ids.e,
        name: `${marker}-weight`,
        record_type: "weight_reps",
      });
      await create(a, "exercises", {
        id: ids.e2,
        name: `${marker}-reps`,
        record_type: "reps",
      });
      await fixtures.reserve(a, "menus", ids.menu);
      await fixtures.reserve(a, "menu_items", ids.item);
      await fixtures.reserve(a, "menu_items", ids.item2);
      const args = {
        p_id: ids.menu,
        p_name: marker,
        p_items: [
          { id: ids.item, exerciseId: ids.e, plannedSets: 2 },
          { id: ids.item2, exerciseId: ids.e2, plannedSets: 3 },
        ],
        p_expected: null,
      };
      const saved = required(
        await a.client.rpc("save_training_menu", args),
        "menu RPC create",
      );
      check(`${a.label}/menu create`, saved.items.length === 2);
      const before = await menuSnapshot(a, ids.menu);
      const failure = await a.client.rpc("save_training_menu", {
        ...args,
        p_name: `${marker}-fail`,
        p_expected: saved,
        p_items: [args.p_items[0], { ...args.p_items[1], id: ids.item }],
      });
      check(
        `${a.label}/menu late failure rejected`,
        failure.error?.code === "23505",
        failure.error?.code,
      );
      check(
        `${a.label}/menu rollback complete`,
        isDeepStrictEqual(before, await menuSnapshot(a, ids.menu)),
      );
      const updated = required(
        await a.client.rpc("save_training_menu", {
          ...args,
          p_expected: saved,
          p_name: `${marker}-updated`,
          p_items: [{ ...args.p_items[1], plannedSets: 4 }, args.p_items[0]],
        }),
        "menu RPC update",
      );
      check(
        `${a.label}/menu reorder and save`,
        updated.items[0].exerciseId === ids.e2 &&
          updated.items[0].plannedSets === 4,
      );
      const stale = await a.client
        .rpc("save_training_menu", {
          ...args,
          p_expected: saved,
        })
        .retry(false)
        .abortSignal(AbortSignal.timeout(15000));
      check(
        `${a.label}/menu conflict error response`,
        stale.error?.code === "40001",
        stale.error?.code,
      );
      await create(a, "sessions", {
        id: ids.session,
        name: marker,
        started_at: "2020-01-01T14:50:00Z",
        ended_at: "2020-01-01T15:20:00Z",
        status: "completed",
        revision: 1,
      });
      await create(a, "session_exercises", {
        id: ids.section,
        session_id: ids.session,
        exercise_id: ids.e,
        exercise_name_snapshot: "phase3 historical snapshot",
        record_type_snapshot: "weight_reps",
        position: 0,
      });
      await create(a, "workout_sets", {
        id: ids.set,
        session_exercise_id: ids.section,
        record_type: "weight_reps",
        position: 0,
        weight_kg: 50,
        reps: 5,
        is_performed: true,
        is_copied: false,
      });
      const section = {
        id: ids.section,
        exerciseId: ids.e,
        name: "must not overwrite snapshot",
        type: "duration",
        sets: [
          {
            id: ids.set,
            weight: "60",
            reps: "6",
            seconds: "",
            performed: true,
            copied: false,
          },
        ],
      };
      const editArgs = {
        p_id: ids.session,
        p_revision: 1,
        p_name: `${marker}-edited`,
        p_ended_at: "2020-01-01T15:30:00Z",
        p_sections: [section],
      };
      await fixtures.reserve(a, "workout_sets", ids.badSet);
      const historyBefore = await historySnapshot(a, ids.session);
      const bad = await a.client.rpc("edit_training_history", {
        ...editArgs,
        p_sections: [
          {
            ...section,
            sets: [
              ...section.sets,
              { ...section.sets[0], id: ids.badSet, reps: "-1" },
            ],
          },
        ],
      });
      check(
        `${a.label}/history late failure rejected`,
        bad.error?.code === "23514",
        bad.error?.code,
      );
      check(
        `${a.label}/history rollback complete`,
        isDeepStrictEqual(historyBefore, await historySnapshot(a, ids.session)),
      );
      const invalidEnd = await a.client.rpc("edit_training_history", {
        ...editArgs,
        p_ended_at: "2019-01-01T00:00:00Z",
      });
      check(
        `${a.label}/invalid end rejected`,
        invalidEnd.error?.code === "22023",
        invalidEnd.error?.code,
      );
      const revision = required(
        await a.client.rpc("edit_training_history", editArgs),
        "history RPC edit",
      );
      const edited = await historySnapshot(a, ids.session);
      check(
        `${a.label}/history edit and revision`,
        revision === 2 &&
          edited.parent[0].revision === 2 &&
          Number(edited.sets[0].weight_kg) === 60,
      );
      check(
        `${a.label}/snapshot retained`,
        edited.sections[0].exercise_name_snapshot ===
          "phase3 historical snapshot" &&
          edited.sections[0].record_type_snapshot === "weight_reps",
      );
      const historyStale = await a.client
        .rpc("edit_training_history", editArgs)
        .retry(false)
        .abortSignal(AbortSignal.timeout(15000));
      check(
        `${a.label}/history conflict error response`,
        historyStale.error?.code === "40001",
        historyStale.error?.code,
      );
      groups.push({ a, ids, args, saved: updated, editArgs, edited });
    }
    for (const g of groups) {
      const other = accounts.find((a) => a !== g.a);
      for (const table of ["menus", "sessions", "exercises"]) {
        const id =
          table === "menus"
            ? g.ids.menu
            : table === "sessions"
              ? g.ids.session
              : g.ids.e;
        const read = await other.client.from(table).select("id").eq("id", id);
        check(
          `${g.a.label}/${table}/other read denied`,
          !read.error && read.data.length === 0,
        );
      }
      for (const [name, args] of [
        ["save_training_menu", { ...g.args, p_expected: g.saved }],
        ["edit_training_history", { ...g.editArgs, p_revision: 2 }],
        ["archive_training_exercise", { p_id: g.ids.e }],
      ]) {
        const before = {
          menu: await menuSnapshot(g.a, g.ids.menu),
          history: await historySnapshot(g.a, g.ids.session),
        };
        const cross = await other.client.rpc(name, args);
        check(
          `${g.a.label}/${name}/other denied`,
          ["P0002", "42501"].includes(cross.error?.code),
          cross.error?.code,
        );
        check(
          `${g.a.label}/${name}/other unchanged`,
          isDeepStrictEqual(before, {
            menu: await menuSnapshot(g.a, g.ids.menu),
            history: await historySnapshot(g.a, g.ids.session),
          }),
        );
        const anon = await anonymous.rpc(name, args);
        check(
          `${g.a.label}/${name}/anonymous execute denied`,
          anon.error?.code === "42501" &&
            /permission denied for function/i.test(anon.error?.message ?? ""),
          anon.error?.code,
        );
      }
      const archived = await g.a.client.rpc("archive_training_exercise", {
        p_id: g.ids.e,
      });
      required(archived, "archive RPC");
      const master = required(
        await g.a.client
          .from("exercises")
          .select("archived_at")
          .eq("id", g.ids.e),
        "archived master read",
      );
      const menu = await menuSnapshot(g.a, g.ids.menu);
      check(
        `${g.a.label}/archive removes only matching menu item`,
        !!master[0].archived_at &&
          menu.items.length === 1 &&
          menu.items[0].exercise_id === g.ids.e2,
      );
      check(
        `${g.a.label}/archive preserves history`,
        isDeepStrictEqual(g.edited, await historySnapshot(g.a, g.ids.session)),
      );
      required(
        await g.a.client.rpc("archive_training_exercise", { p_id: g.ids.e2 }),
        "archive last menu item",
      );
      const empty = await menuSnapshot(g.a, g.ids.menu);
      check(
        `${g.a.label}/empty menu retained`,
        empty.menu.length === 1 && empty.items.length === 0,
      );
      const noDelete = await other.client
        .from("sessions")
        .delete()
        .eq("id", g.ids.session)
        .select("id");
      check(
        `${g.a.label}/other history delete denied`,
        !noDelete.error && noDelete.data.length === 0,
      );
      const removed = required(
        await g.a.client
          .from("sessions")
          .delete()
          .eq("user_id", g.a.userId)
          .eq("id", g.ids.session)
          .eq("revision", 2)
          .select("id"),
        "history delete",
      );
      const gone = await historySnapshot(g.a, g.ids.session);
      check(
        `${g.a.label}/history cascade deletion`,
        removed.length === 1 &&
          !gone.parent.length &&
          !gone.sections.length &&
          !gone.sets.length,
      );
      const removedMenu = required(
        await g.a.client
          .from("menus")
          .delete()
          .eq("user_id", g.a.userId)
          .eq("id", g.ids.menu)
          .select("id"),
        "menu delete",
      );
      check(
        `${g.a.label}/menu cascade deletion`,
        removedMenu.length === 1 &&
          (await menuSnapshot(g.a, g.ids.menu)).items.length === 0,
      );
    }
  }
} catch (error) {
  check("execution", false);
  console.log(error instanceof Error ? error.message : "Verification stopped");
} finally {
  try {
    const remaining = await fixtures.cleanup(accounts);
    check("fixture cleanup", remaining === 0);
  } finally {
    for (const a of accounts) await a.client.auth.signOut({ scope: "local" });
  }
}
console.log(
  JSON.stringify({
    passed: results.filter((r) => r.pass).length,
    failed: results.filter((r) => !r.pass).length,
    remainingFixtures: fixtures.entries.length,
  }),
);
process.exitCode =
  results.some((r) => !r.pass) || fixtures.entries.length ? 1 : 0;
