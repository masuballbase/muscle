// Run only after the separately approved new RPC has been applied.
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { loginClients, makeClient } from "./lib/test-clients.mjs";
import { Phase3Fixtures } from "./lib/phase3-fixtures.mjs";
const accounts = await loginClients(),
  fixtures = new Phase3Fixtures("/tmp/muscle-phase6-sync-fixtures.json"),
  anonymous = makeClient(),
  checks = [];
function check(label, ok, code) {
  checks.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${code ? ` (${code})` : ""}`);
}
function requireResult(r) {
  if (r.error)
    throw new Error(
      `Dedicated fixture operation failed (${r.error.code ?? "network"})`,
    );
  return r.data;
}
async function rpc(client, workout, expected) {
  return client
    .rpc("sync_training_session", { p_workout: workout, p_expected: expected })
    .retry(false)
    .abortSignal(AbortSignal.timeout(20000));
}
async function snapshot(a, w) {
  const parent = requireResult(
    await a.client
      .from("sessions")
      .select("*")
      .eq("user_id", a.userId)
      .eq("id", w.id),
  );
  const sections = requireResult(
    await a.client
      .from("session_exercises")
      .select("*")
      .eq("user_id", a.userId)
      .eq("session_id", w.id)
      .order("id"),
  );
  const sets = sections.length
    ? requireResult(
        await a.client
          .from("workout_sets")
          .select("*")
          .eq("user_id", a.userId)
          .in(
            "session_exercise_id",
            sections.map((s) => s.id),
          )
          .order("id"),
      )
    : [];
  return { parent, sections, sets };
}
let notReady = false;
try {
  fixtures.requireEmpty();
  for (const a of accounts) {
    const r = await rpc(a.client, null, []);
    if (r.error?.code === "PGRST202") {
      notReady = true;
      throw new Error(
        "Synchronization RPC is not available; no fixtures created",
      );
    }
    check(
      `${a.label}/RPC published with early validation`,
      r.error?.code === "22023",
      r.error?.code,
    );
    if (r.error?.code !== "22023")
      throw new Error("Unexpected readiness response");
  }
  for (const a of accounts) {
    const active = requireResult(
      await a.client
        .from("sessions")
        .select("id")
        .eq("user_id", a.userId)
        .eq("status", "active")
        .limit(1),
    );
    if (active.length)
      throw new Error("Existing active data: refusing fixture synchronization");
    const exercise = randomUUID(),
      w = {
        id: randomUUID(),
        name: "phase6-sync-fixture",
        startedAt: new Date(Date.now() - 3600000).toISOString(),
        endedAt: null,
        revision: 1,
        sections: [
          {
            id: randomUUID(),
            exerciseId: exercise,
            name: "phase6-sync-fixture",
            type: "weight_reps",
            sets: [
              {
                id: randomUUID(),
                weight: "50",
                reps: "5",
                seconds: "",
                performed: true,
                copied: false,
              },
            ],
          },
        ],
      };
    await fixtures.reserve(a, "exercises", exercise);
    requireResult(
      await a.client
        .from("exercises")
        .insert({
          id: exercise,
          user_id: a.userId,
          name: `phase6-${randomUUID()}`,
          record_type: "weight_reps",
        }),
    );
    for (const [table, id] of [
      ["sessions", w.id],
      ["session_exercises", w.sections[0].id],
      ["workout_sets", w.sections[0].sets[0].id],
    ])
      await fixtures.reserve(a, table, id);
    const created = await rpc(a.client, w, [null]);
    check(
      `${a.label}/atomic creation`,
      !created.error && created.data === 1,
      created.error?.code,
    );
    requireResult(created);
    const initial = await snapshot(a, w);
    const replay = await rpc(a.client, w, [null]);
    check(
      `${a.label}/exact replay no duplicate or row rewrite`,
      !replay.error &&
        replay.data === 1 &&
        isDeepStrictEqual(initial, await snapshot(a, w)),
      replay.error?.code,
    );
    const second = structuredClone(w);
    second.revision = 2;
    second.name = "phase6-second";
    second.sections[0].sets[0].weight = "55";
    const updated = await rpc(a.client, second, [w]);
    check(
      `${a.label}/advance confirmed base`,
      !updated.error && updated.data === 2,
      updated.error?.code,
    );
    requireResult(updated);
    const before = await snapshot(a, w);
    const third = {
      ...structuredClone(second),
      name: "phase6-third",
      revision: 3,
    };
    for (const [label, target, expected] of [
      ["stale base", third, [w]],
      [
        "same revision different content",
        { ...second, name: "divergent" },
        [second],
      ],
    ]) {
      const r = await rpc(a.client, target, expected);
      check(
        `${a.label}/${label} HTTP 409 PT409`,
        r.status === 409 && r.error?.code === "PT409",
        `HTTP_${r.status}/${r.error?.code ?? "none"}`,
      );
      check(
        `${a.label}/${label} unchanged`,
        isDeepStrictEqual(before, await snapshot(a, w)),
      );
    }
    const bad = structuredClone(third),
      badId = randomUUID();
    await fixtures.reserve(a, "workout_sets", badId);
    bad.sections[0].sets.push({
      ...bad.sections[0].sets[0],
      id: badId,
      reps: "0",
    });
    const failed = await rpc(a.client, bad, [second]);
    check(
      `${a.label}/late invalid set rejected`,
      failed.error?.code === "23514",
      failed.error?.code,
    );
    check(
      `${a.label}/entire previous graph rolled back`,
      isDeepStrictEqual(before, await snapshot(a, w)),
    );
    const completed = { ...third, endedAt: new Date().toISOString() };
    const done = await rpc(a.client, completed, [w, second]);
    check(
      `${a.label}/unacknowledged previous commit reconciled and completion published`,
      !done.error && done.data === 3,
      done.error?.code,
    );
    requireResult(done);
    const formal = await snapshot(a, w);
    const again = await rpc(a.client, completed, [w, second]);
    check(
      `${a.label}/completion replay exact and idempotent`,
      !again.error && isDeepStrictEqual(formal, await snapshot(a, w)),
    );
    const other = accounts.find((b) => b !== a),
      cross = await rpc(
        other.client,
        { ...completed, name: "not owner", revision: 4 },
        [completed],
      );
    check(`${a.label}/other owner denied`, !!cross.error, cross.error?.code);
    const anon = await rpc(anonymous, completed, [null]);
    check(
      `${a.label}/anonymous EXECUTE denied`,
      anon.error?.code === "42501",
      anon.error?.code,
    );
    check(
      `${a.label}/owner graph preserved`,
      isDeepStrictEqual(formal, await snapshot(a, w)),
    );
    const changed = await rpc(
      a.client,
      { ...completed, name: "formal overwrite", revision: 4 },
      [completed],
    );
    check(
      `${a.label}/formal edit through sync refused`,
      changed.error?.code === "PT409",
      changed.error?.code,
    );
    check(
      `${a.label}/formal graph unchanged`,
      isDeepStrictEqual(formal, await snapshot(a, w)),
    );
    requireResult(
      await a.client
        .from("sessions")
        .delete()
        .eq("id", w.id)
        .eq("user_id", a.userId),
    );
    const deleted = await rpc(a.client, { ...completed, revision: 4 }, [
      completed,
    ]);
    check(
      `${a.label}/known deleted session not resurrected`,
      deleted.error?.code === "PT409" &&
        (await snapshot(a, w)).parent.length === 0,
      deleted.error?.code,
    );
  }
} catch (e) {
  if (!notReady) check("execution", false);
  console.log(e instanceof Error ? e.message : "Verification stopped");
} finally {
  const remaining = await fixtures.cleanup(accounts);
  check("fixture cleanup and readback", remaining === 0);
  for (const a of accounts) await a.client.auth.signOut({ scope: "local" });
  console.log(
    JSON.stringify({
      passed: checks.filter(Boolean).length,
      failed: checks.filter((v) => !v).length,
      remainingFixtures: remaining,
      notReady,
    }),
  );
  process.exitCode = notReady ? 2 : checks.some((v) => !v) || remaining ? 1 : 0;
}
