import { it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
it("proposed invoker RPC is atomic, idempotent and rejects same-revision divergent data with PT409", async () => {
  const db = new PGlite();
  try {
    await db.exec(readFileSync("tests/sql/phase3-fixture.sql", "utf8"));
    await db.exec(readFileSync("db/proposals/phase6-atomic-sync.sql", "utf8"));
    const actor = id(1),
      exercise = id(2);
    await db.query(
      "INSERT INTO exercises VALUES($1,$2,'fixture','weight_reps',null)",
      [exercise, actor],
    );
    const w = {
      id: id(3),
      name: "fixture",
      startedAt: "2026-11-04T00:00:00Z",
      endedAt: null,
      revision: 1,
      sections: [
        {
          id: id(4),
          exerciseId: exercise,
          name: "fixture",
          type: "weight_reps",
          sets: [
            {
              id: id(5),
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
    const call = (value: typeof w, expected: unknown[]) =>
      db.transaction(async (tx) => {
        await tx.exec("SET LOCAL ROLE authenticated");
        await tx.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [
          actor,
        ]);
        return (
          await tx.query<{ value: number }>(
            "SELECT public.sync_training_session($1::jsonb,$2::jsonb) AS value",
            [JSON.stringify(value), JSON.stringify(expected)],
          )
        ).rows[0].value;
      });
    expect(await call(w, [null])).toBe(1);
    expect(await call(w, [])).toBe(1);
    expect(await call(w, [null])).toBe(1);
    const second = { ...w, revision: 2, name: "updated" };
    expect(await call(second, [w])).toBe(2);
    await expect(
      call({ ...second, name: "divergent" }, [second]),
    ).rejects.toMatchObject({ code: "PT409" });
    await expect(call({ ...second, revision: 3 }, [w])).rejects.toMatchObject({
      code: "PT409",
    });
    const invalid = structuredClone(second);
    invalid.revision = 3;
    invalid.sections[0].sets.push({
      ...invalid.sections[0].sets[0],
      id: id(6),
      reps: "0",
    });
    await expect(call(invalid, [second])).rejects.toMatchObject({
      code: "23514",
    });
    expect(
      (await db.query<{ revision: number }>("SELECT revision FROM sessions"))
        .rows[0].revision,
    ).toBe(2);
    expect((await db.query("SELECT id FROM workout_sets")).rows).toHaveLength(
      1,
    );
  } finally {
    await db.close();
  }
});
it("denies anon execution, checks owner RLS and never replaces a different owner session", async () => {
  const db = new PGlite();
  try {
    await db.exec(readFileSync("tests/sql/phase3-fixture.sql", "utf8"));
    await db.exec(readFileSync("db/proposals/phase6-atomic-sync.sql", "utf8"));
    const acl = (
      await db.query<{
        invoker: boolean;
        anon: boolean;
        authenticated: boolean;
      }>(
        "SELECT NOT prosecdef AS invoker,has_function_privilege('anon',oid,'EXECUTE') AS anon,has_function_privilege('authenticated',oid,'EXECUTE') AS authenticated FROM pg_proc WHERE proname='sync_training_session'",
      )
    ).rows[0];
    expect(acl).toEqual({ invoker: true, anon: false, authenticated: true });
    const call = (actor: string, w: unknown, expected: unknown[]) =>
      db.transaction(async (tx) => {
        await tx.exec("SET LOCAL ROLE authenticated");
        await tx.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [
          actor,
        ]);
        return tx.query(
          "SELECT public.sync_training_session($1::jsonb,$2::jsonb)",
          [JSON.stringify(w), JSON.stringify(expected)],
        );
      });
    const w = {
      id: id(10),
      name: "owner A",
      startedAt: "2026-11-04T00:00:00Z",
      endedAt: null,
      revision: 1,
      sections: [],
    };
    await call(id(1), w, [null]);
    await expect(
      call(id(2), { ...w, name: "owner B", revision: 2 }, [w]),
    ).rejects.toMatchObject({ code: "PT409" });
    expect(
      (await db.query<{ name: string }>("SELECT name FROM sessions")).rows[0]
        .name,
    ).toBe("owner A");
  } finally {
    await db.close();
  }
});
it("reconciles an older unacknowledged commit, publishes offline completion once and refuses deleted/changed formal records", async () => {
  const db = new PGlite();
  try {
    await db.exec(readFileSync("tests/sql/phase3-fixture.sql", "utf8"));
    await db.exec(readFileSync("db/proposals/phase6-atomic-sync.sql", "utf8"));
    const call = (w: unknown, expected: unknown[]) =>
      db.transaction(async (tx) => {
        await tx.exec("SET LOCAL ROLE authenticated");
        await tx.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [
          id(1),
        ]);
        return tx.query(
          "SELECT public.sync_training_session($1::jsonb,$2::jsonb)",
          [JSON.stringify(w), JSON.stringify(expected)],
        );
      });
    const a = {
      id: id(20),
      name: "first",
      startedAt: "2026-11-04T00:00:00Z",
      endedAt: null as string | null,
      revision: 1,
      sections: [],
    };
    await call(a, [null]);
    const b = { ...a, name: "second", revision: 2 };
    await call(b, [a]);
    const c = { ...b, endedAt: "2026-11-04T01:00:00Z", revision: 3 };
    await call(c, [a, b]);
    await call(c, [a, b]);
    expect((await db.query("SELECT id FROM sessions")).rows).toHaveLength(1);
    await expect(
      call({ ...c, name: "changed", revision: 4 }, [c]),
    ).rejects.toMatchObject({ code: "PT409" });
    await db.exec("DELETE FROM sessions");
    await expect(call({ ...c, revision: 4 }, [c])).rejects.toMatchObject({
      code: "PT409",
    });
    expect((await db.query("SELECT id FROM sessions")).rows).toHaveLength(0);
  } finally {
    await db.close();
  }
});
