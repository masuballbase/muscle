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
