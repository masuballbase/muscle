// Writes only UUID-tagged fixtures; never performs DDL or touches existing rows.
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { loginClients, makeClient } from "./lib/test-clients.mjs";
const manifestPath =
  process.env.MUSCLE_FIXTURE_MANIFEST || "/tmp/muscle-phase1-rls-fixtures.json";
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
const accounts = await loginClients();
const anonymous = makeClient();
let journal = existsSync(manifestPath)
  ? JSON.parse(readFileSync(manifestPath, "utf8"))
  : [];
const results = [];
function save() {
  writeFileSync(manifestPath, JSON.stringify(journal), { mode: 0o600 });
}
function query(client, table, filter) {
  let q = client.from(table);
  return {
    select: () => apply(q.select("*"), filter),
    update: (patch) => apply(q.update(patch).select("*"), filter),
    delete: () => apply(q.delete().select("*"), filter),
  };
}
function apply(q, filter) {
  for (const [key, value] of Object.entries(filter)) q = q.eq(key, value);
  return q;
}
function record(label, pass, code) {
  results.push({
    label,
    status: pass ? "PASS" : "FAIL",
    ...(code ? { code } : {}),
  });
  console.log(`${pass ? "PASS" : "FAIL"} ${label}${code ? ` (${code})` : ""}`);
}
function required(result, label) {
  if (result.error) {
    const message = result.error.message ?? "";
    const column = message.match(/column "([a-z_]+)"/);
    const constraint = message.match(/constraint "([a-z_]+)"/);
    throw new Error(
      `${label}: ${result.error.code}${column ? ` column=${column[1]}` : ""}${constraint ? ` constraint=${constraint[1]}` : ""}`,
    );
  }
  return result.data;
}
async function reserve(account, table, row, filter) {
  const check = required(
    await query(account.client, table, filter).select(),
    "fixture preflight",
  );
  if (check.length)
    throw new Error("Fixture key already exists; refusing to touch it");
  const entry = { account: account.label, table, filter };
  journal.push(entry);
  save();
  return entry;
}
async function insertFixture(account, table, row, filter) {
  await reserve(account, table, row, filter);
  const inserted = required(
    await account.client.from(table).insert(row).select("*"),
    `${account.label}/${table} create`,
  );
  if (inserted.length !== 1)
    throw new Error(`${table}: expected one inserted fixture`);
  record(`${account.label}/${table}/own CREATE`, true);
  return { table, row, filter };
}
async function cleanup() {
  // Reverse insertion order keeps foreign-key parents until their children are gone.
  for (const entry of [...journal].reverse()) {
    const account = accounts.find((a) => a.label === entry.account);
    if (
      !account ||
      !tables.includes(entry.table) ||
      !entry.filter ||
      !Object.keys(entry.filter).length
    )
      throw new Error("Invalid cleanup manifest");
    // Owner filter is mandatory even for generated UUIDs.
    const filter = { ...entry.filter, user_id: account.userId };
    const deleted = await query(account.client, entry.table, filter).delete();
    if (deleted.error) {
      record(
        `cleanup/${entry.account}/${entry.table}`,
        false,
        deleted.error.code,
      );
      continue;
    }
    const remaining = await query(account.client, entry.table, filter).select();
    if (remaining.error || remaining.data.length) {
      record(
        `cleanup/${entry.account}/${entry.table}`,
        false,
        remaining.error?.code,
      );
      continue;
    }
    journal = journal.filter((item) => item !== entry);
    save();
    record(`cleanup/${entry.account}/${entry.table}`, true);
  }
}
function mutation(table) {
  return {
    exercises: { name: "RLS fixture updated" },
    menus: { name: "RLS fixture updated" },
    menu_items: { planned_sets: 3 },
    sessions: { name: "RLS fixture updated" },
    session_exercises: { exercise_name_snapshot: "RLS fixture updated" },
    workout_sets: { reps: 3 },
    weekly_goal_schedule: { target_days: 3 },
    inbody_records: { source_filename: "rls-fixture-updated.csv" },
  }[table];
}
try {
  if (journal.length && !process.argv.includes("--cleanup"))
    throw new Error(
      "Outstanding fixture journal: run verify:rls:cleanup first",
    );
  if (!process.argv.includes("--cleanup")) {
    // Confirm required ownership and key columns before any writes.
    for (const table of tables)
      required(
        await accounts[0].client.from(table).select("user_id").limit(0),
        `${table} owner column`,
      );
    const fixtures = [];
    for (const account of accounts) {
      const ids = Object.fromEntries(
        tables.map((table) => [table, randomUUID()]),
      );
      const marker = `phase1-rls-${randomUUID()}`;
      // Use an unoccupied future Monday rather than overwriting any real goal schedule.
      let monday;
      for (let attempt = 0; attempt < 10; attempt++) {
        const date = new Date(
          Date.UTC(2400, 0, 3 + 7 * Math.floor(Math.random() * 5000)),
        );
        // Align to Monday in UTC.
        date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
        monday = date.toISOString().slice(0, 10);
        const rows = required(
          await account.client
            .from("weekly_goal_schedule")
            .select("user_id")
            .eq("user_id", account.userId)
            .eq("effective_monday", monday),
          "goal preflight",
        );
        if (!rows.length) break;
        monday = undefined;
      }
      if (!monday) throw new Error("No isolated goal fixture date found");
      const owner = { user_id: account.userId };
      const payloads = {
        exercises: {
          id: ids.exercises,
          ...owner,
          name: marker,
          record_type: "weight_reps",
        },
        menus: { id: ids.menus, ...owner, name: marker },
        menu_items: {
          id: ids.menu_items,
          ...owner,
          menu_id: ids.menus,
          exercise_id: ids.exercises,
          position: 0,
          planned_sets: 2,
        },
        sessions: {
          id: ids.sessions,
          ...owner,
          name: marker,
          started_at: "2400-01-03T00:00:00Z",
          ended_at: "2400-01-03T00:01:00Z",
          status: "completed",
        },
        session_exercises: {
          id: ids.session_exercises,
          ...owner,
          session_id: ids.sessions,
          exercise_id: ids.exercises,
          exercise_name_snapshot: marker,
          record_type_snapshot: "weight_reps",
          position: 0,
        },
        workout_sets: {
          id: ids.workout_sets,
          ...owner,
          session_exercise_id: ids.session_exercises,
          position: 0,
          record_type: "weight_reps",
          weight_kg: 1,
          reps: 2,
          is_performed: false,
        },
        weekly_goal_schedule: {
          id: ids.weekly_goal_schedule,
          ...owner,
          effective_monday: monday,
          target_days: 2,
        },
        inbody_records: {
          id: ids.inbody_records,
          ...owner,
          measured_on: "2400-01-03",
          source_filename: `${marker}.csv`,
          raw_fields: {},
        },
      };
      const group = { account, rows: [] };
      fixtures.push(group);
      for (const table of tables) {
        const row = payloads[table];
        const filter = { id: row.id };
        group.rows.push(await insertFixture(account, table, row, filter));
      }
    }
    for (const { account, rows } of fixtures) {
      const other = accounts.find((a) => a !== account);
      for (const fixture of rows) {
        const { table, row, filter } = fixture;
        const own = required(
          await query(account.client, table, filter).select(),
          "own read",
        );
        record(`${account.label}/${table}/own READ`, own.length === 1);
        const changed = required(
          await query(account.client, table, filter).update(mutation(table)),
          "own update",
        );
        record(
          `${account.label}/${table}/own UPDATE`,
          changed.length === 1 &&
            Object.entries(mutation(table)).every(
              ([key, value]) => changed[0][key] === value,
            ),
        );
        const before = required(
          await query(account.client, table, filter).select(),
          "snapshot",
        );
        for (const [label, client] of [
          [other.label, other.client],
          ["anonymous", anonymous],
        ]) {
          const read = await query(client, table, filter).select();
          record(
            `${account.label}/${table}/${label} READ denied`,
            read.error?.code === "42501" ||
              (!read.error && read.data.length === 0),
            read.error?.code,
          );
          const update = await query(client, table, filter).update(
            mutation(table),
          );
          const afterUpdate = required(
            await query(account.client, table, filter).select(),
            "verify unauthorized update",
          );
          record(
            `${account.label}/${table}/${label} UPDATE denied`,
            (update.error?.code === "42501" ||
              (!update.error && update.data.length === 0)) &&
              JSON.stringify(before) === JSON.stringify(afterUpdate),
            update.error?.code,
          );
          const deletion = await query(client, table, filter).delete();
          const afterDelete = required(
            await query(account.client, table, filter).select(),
            "verify unauthorized delete",
          );
          record(
            `${account.label}/${table}/${label} DELETE denied`,
            (deletion.error?.code === "42501" ||
              (!deletion.error && deletion.data.length === 0)) &&
              afterDelete.length === 1,
            deletion.error?.code,
          );
          const forged = { ...row, id: randomUUID() };
          if (table === "weekly_goal_schedule") {
            const date = new Date(`${row.effective_monday}T00:00:00Z`);
            date.setUTCDate(date.getUTCDate() + 7);
            forged.effective_monday = date.toISOString().slice(0, 10);
          } else forged.id = randomUUID();
          if (table === "exercises") {
            forged.name = `phase1-rls-${randomUUID()}`;
          }
          // Avoid unrelated uniqueness checks on parent/position pairs.
          if ("position" in forged)
            forged.position = 100 + Math.floor(Math.random() * 100000);
          const forgedFilter = { id: forged.id };
          await reserve(account, table, forged, forgedFilter);
          const inserted = await client.from(table).insert(forged).select("*");
          record(
            `${account.label}/${table}/${label} INSERT spoof denied`,
            inserted.error?.code === "42501",
            inserted.error?.code,
          );
        }
        // WITH CHECK must also stop the owner from transferring a fixture to another account.
        const transfer = await query(account.client, table, filter).update({
          user_id: other.userId,
        });
        record(
          `${account.label}/${table}/ownership transfer denied`,
          transfer.error?.code === "42501",
          transfer.error?.code,
        );
        if (!transfer.error && transfer.data.length) {
          journal.push({ account: other.label, table, filter });
          save();
        }
      }
    }
    const references = {
      menu_items: ["menu_id", "exercise_id"],
      session_exercises: ["session_id", "exercise_id"],
      workout_sets: ["session_exercise_id"],
    };
    const parentTables = {
      menu_id: "menus",
      exercise_id: "exercises",
      session_id: "sessions",
      session_exercise_id: "session_exercises",
    };
    for (const { account, rows } of fixtures) {
      const otherGroup = fixtures.find((group) => group.account !== account);
      for (const fixture of rows)
        for (const column of references[fixture.table] ?? []) {
          const parent = otherGroup.rows.find(
            (row) => row.table === parentTables[column],
          );
          const forged = {
            ...fixture.row,
            id: randomUUID(),
            [column]: parent.row.id,
            position: 100 + Math.floor(Math.random() * 100000),
          };
          const filter = { id: forged.id };
          await reserve(account, fixture.table, forged, filter);
          const result = await account.client
            .from(fixture.table)
            .insert(forged)
            .select("*");
          record(
            `${account.label}/${fixture.table}/foreign ${column} INSERT denied`,
            ["42501", "23503"].includes(result.error?.code),
            result.error?.code,
          );
          if (!result.error)
            required(
              await query(account.client, fixture.table, filter).delete(),
              "remove cross-parent fixture",
            );
          const update = await query(
            account.client,
            fixture.table,
            fixture.filter,
          ).update({ [column]: parent.row.id });
          const after = required(
            await query(account.client, fixture.table, fixture.filter).select(),
            "verify parent unchanged",
          );
          const denied =
            (["42501", "23503"].includes(update.error?.code) ||
              (!update.error && update.data.length === 0)) &&
            after.length === 1 &&
            after[0][column] === fixture.row[column];
          record(
            `${account.label}/${fixture.table}/foreign ${column} UPDATE denied`,
            denied,
            update.error?.code,
          );
          if (!update.error && update.data.length)
            required(
              await query(account.client, fixture.table, fixture.filter).update(
                { [column]: fixture.row[column] },
              ),
              "restore fixture parent",
            );
        }
    }
    // Delete only after cross-account tests have completed for both users.
    for (const { account, rows } of [...fixtures].reverse())
      for (const { table, filter } of [...rows].reverse()) {
        const deletion = await query(account.client, table, filter).delete();
        const remaining = await query(account.client, table, filter).select();
        record(
          `${account.label}/${table}/own DELETE`,
          !deletion.error &&
            deletion.data.length === 1 &&
            !remaining.error &&
            remaining.data.length === 0,
          deletion.error?.code,
        );
      }
  }
} catch (error) {
  record("execution", false);
  console.log(error instanceof Error ? error.message : "Verification stopped");
} finally {
  await cleanup();
  for (const account of accounts)
    await account.client.auth.signOut({ scope: "local" });
}
const failures = results.filter((result) => result.status === "FAIL").length;
console.log(
  JSON.stringify({
    passed: results.length - failures,
    failed: failures,
    remainingFixtureEntries: journal.length,
  }),
);
process.exitCode = failures || journal.length ? 1 : 0;
