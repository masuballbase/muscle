import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, afterAll, it, expect } from "vitest";
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const A = id(1),
  B = id(2),
  E = id(10),
  F = id(11),
  FOREIGN = id(12),
  M = id(20),
  ITEM = id(21),
  S = id(30),
  SECTION = id(31),
  SET = id(32);
let db: PGlite;
const items = [{ id: ITEM, exerciseId: E, plannedSets: 2 }];
const sections = [
  {
    id: SECTION,
    exerciseId: E,
    name: "client must not replace snapshot",
    type: "duration",
    sets: [
      {
        id: SET,
        weight: "60",
        reps: "5",
        seconds: "",
        performed: true,
        copied: false,
      },
    ],
  },
];
async function actor(user = A) {
  await db.exec(
    `RESET ROLE; SELECT set_config('request.jwt.claim.sub','${user}',false); SET ROLE authenticated;`,
  );
}
async function saveMenu(expected: unknown = null, next = items, name = "menu") {
  return (
    await db.query<{ saved: unknown }>(
      "SELECT public.save_training_menu($1,$2,$3::jsonb,$4::jsonb) AS saved",
      [
        M,
        name,
        JSON.stringify(next),
        expected === null ? null : JSON.stringify(expected),
      ],
    )
  ).rows[0].saved;
}
async function edit(next = sections, revision = 1) {
  return (
    await db.query<{ revision: number }>(
      "SELECT public.edit_training_history($1,$2,$3,$4,$5::jsonb) AS revision",
      [S, revision, "edited", "2026-01-02T03:00:00Z", JSON.stringify(next)],
    )
  ).rows[0].revision;
}
async function snapshot() {
  return {
    menus: (await db.query("SELECT * FROM menus ORDER BY id")).rows,
    items: (await db.query("SELECT * FROM menu_items ORDER BY id")).rows,
    sessions: (await db.query("SELECT * FROM sessions ORDER BY id")).rows,
    sections: (await db.query("SELECT * FROM session_exercises ORDER BY id"))
      .rows,
    sets: (await db.query("SELECT * FROM workout_sets ORDER BY id")).rows,
  };
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(readFileSync("tests/sql/phase3-fixture.sql", "utf8"));
  await db.exec(readFileSync("db/proposals/phase3-atomic-writes.sql", "utf8"));
  await db.exec(
    readFileSync("db/proposals/phase3-conflict-response.sql", "utf8"),
  );
}, 30000);
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  await db.exec(`RESET ROLE; TRUNCATE exercises,menus,sessions CASCADE;
 INSERT INTO exercises VALUES('${E}','${A}','latest master','weight_reps',null),('${F}','${A}','second','reps',null),('${FOREIGN}','${B}','other','weight_reps',null);
 INSERT INTO sessions VALUES('${S}','${A}','original','2026-01-01T23:00:00Z','2026-01-02T01:00:00Z','completed',1);
 INSERT INTO session_exercises VALUES('${SECTION}','${A}','${S}','${E}','historical name','weight_reps',0);
 INSERT INTO workout_sets VALUES('${SET}','${A}','${SECTION}','weight_reps',0,50,5,null,true,false);`);
  await actor();
});
it("creates and atomically reorders a menu with canonical optimistic snapshots", async () => {
  const old = await saveMenu();
  const next = [{ id: id(22), exerciseId: F, plannedSets: 3 }, ...items];
  const saved = await saveMenu(old, next, " renamed ");
  expect(saved).toEqual({ id: M, name: "renamed", items: next });
  expect(
    (
      await db.query<{ position: number }>(
        "SELECT position FROM menu_items ORDER BY position",
      )
    ).rows.map((r) => r.position),
  ).toEqual([0, 1]);
});
it("rolls back deletion and earlier inserted rows when a later menu item fails", async () => {
  const old = await saveMenu();
  const before = await snapshot();
  await expect(
    saveMenu(
      old,
      [...items, { id: ITEM, exerciseId: F, plannedSets: 3 }],
      "bad",
    ),
  ).rejects.toMatchObject({ code: "23505" });
  expect(await snapshot()).toEqual(before);
});
it("rejects stale menu snapshots without changing formal rows", async () => {
  const old = await saveMenu();
  await saveMenu(old, items, "new");
  const before = await snapshot();
  await expect(saveMenu(old)).rejects.toMatchObject({ code: "PT409" });
  expect(await snapshot()).toEqual(before);
});
it("rejects foreign menu exercises and foreign ownership", async () => {
  const old = await saveMenu();
  const before = await snapshot();
  await expect(
    saveMenu(old, [{ id: id(22), exerciseId: FOREIGN, plannedSets: 1 }]),
  ).rejects.toMatchObject({ code: "42501" });
  expect(await snapshot()).toEqual(before);
  await actor(B);
  await expect(saveMenu(old)).rejects.toMatchObject({ code: "P0002" });
  expect((await db.query("SELECT * FROM menus")).rows).toHaveLength(0);
});
it("preserves a retained historical name/type and increments revision exactly once", async () => {
  expect(await edit()).toBe(2);
  expect(
    (
      await db.query(
        "SELECT exercise_name_snapshot,record_type_snapshot FROM session_exercises",
      )
    ).rows,
  ).toEqual([
    {
      exercise_name_snapshot: "historical name",
      record_type_snapshot: "weight_reps",
    },
  ]);
  expect(
    (await db.query<{ reps: number }>("SELECT reps FROM workout_sets")).rows[0]
      .reps,
  ).toBe(5);
  await expect(edit()).rejects.toMatchObject({ code: "PT409" });
});
it("rolls back all historical rows and the parent after a later set fails", async () => {
  const before = await snapshot();
  const invalid = [
    {
      ...sections[0],
      sets: [
        ...sections[0].sets,
        { ...sections[0].sets[0], id: id(33), reps: "-1" },
      ],
    },
  ];
  await expect(edit(invalid)).rejects.toMatchObject({ code: "23514" });
  expect(await snapshot()).toEqual(before);
});
it("rejects invalid end dates and foreign additions without replacing history", async () => {
  const before = await snapshot();
  await expect(
    db.query("SELECT public.edit_training_history($1,1,$2,$3,$4::jsonb)", [
      S,
      "changed",
      "2025-12-01T00:00:00Z",
      JSON.stringify(sections),
    ]),
  ).rejects.toMatchObject({ code: "22023" });
  await expect(
    edit([{ ...sections[0], id: id(34), exerciseId: FOREIGN }]),
  ).rejects.toMatchObject({ code: "42501" });
  expect(await snapshot()).toEqual(before);
  await actor(B);
  await expect(edit()).rejects.toMatchObject({ code: "P0002" });
});
it("archives the master and clears menu items while retaining historical records", async () => {
  await saveMenu();
  await db.query("SELECT public.archive_training_exercise($1)", [E]);
  expect((await db.query("SELECT * FROM menu_items")).rows).toHaveLength(0);
  expect((await db.query("SELECT * FROM menus")).rows).toHaveLength(1);
  expect((await db.query("SELECT * FROM session_exercises")).rows).toHaveLength(
    1,
  );
  expect(
    (
      await db.query<{ archived_at: unknown }>(
        "SELECT archived_at FROM exercises WHERE id=$1",
        [E],
      )
    ).rows[0].archived_at,
  ).not.toBeNull();
});
it("rolls back related menu deletions if the later master archive fails", async () => {
  await saveMenu();
  const before = await snapshot();
  await db.exec(
    `RESET ROLE;CREATE FUNCTION public.test_archive_failure() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'injected failure' USING ERRCODE='23514';END$$;CREATE TRIGGER test_archive_failure BEFORE UPDATE ON exercises FOR EACH ROW EXECUTE FUNCTION public.test_archive_failure();`,
  );
  try {
    await actor();
    await expect(
      db.query("SELECT public.archive_training_exercise($1)", [E]),
    ).rejects.toMatchObject({ code: "23514" });
    expect(await snapshot()).toEqual(before);
  } finally {
    await db.exec(
      "RESET ROLE; DROP TRIGGER test_archive_failure ON exercises; DROP FUNCTION public.test_archive_failure();",
    );
  }
});
it("deletes a parent and its children together without deleting master exercises", async () => {
  await db.query(
    "DELETE FROM sessions WHERE id=$1 AND revision=1 AND status=$2",
    [S, "completed"],
  );
  expect((await db.query("SELECT * FROM session_exercises")).rows).toHaveLength(
    0,
  );
  expect((await db.query("SELECT * FROM workout_sets")).rows).toHaveLength(0);
  expect((await db.query("SELECT * FROM exercises")).rows).toHaveLength(2);
});
it("uses invoker security and denies anonymous function execution", async () => {
  const config = await db.query<{ prosecdef: boolean }>(
    "SELECT prosecdef FROM pg_proc WHERE proname IN ($1,$2,$3)",
    [
      "save_training_menu",
      "edit_training_history",
      "archive_training_exercise",
    ],
  );
  expect(config.rows).toHaveLength(3);
  expect(config.rows.every((r) => !r.prosecdef)).toBe(true);
  await db.exec("RESET ROLE; SET ROLE anon;");
  await expect(saveMenu()).rejects.toMatchObject({ code: "42501" });
});
it("refuses archive during an active session without changing the menu or master", async () => {
  await saveMenu();
  await db.query(
    "INSERT INTO sessions VALUES($1,$2,'active',$3,null,'active',1)",
    [id(40), A, "2026-01-02T00:00:00Z"],
  );
  await db.query("INSERT INTO session_exercises VALUES($1,$2,$3,$4,$5,$6,0)", [
    id(41),
    A,
    id(40),
    E,
    "active name",
    "weight_reps",
  ]);
  const before = await snapshot();
  await expect(
    db.query("SELECT public.archive_training_exercise($1)", [E]),
  ).rejects.toMatchObject({ code: "22023" });
  expect(await snapshot()).toEqual(before);
});
it("can edit an archived retained exercise without changing its historical name", async () => {
  await db.query("SELECT public.archive_training_exercise($1)", [E]);
  expect(await edit()).toBe(2);
  expect(
    (
      await db.query<{ exercise_name_snapshot: string }>(
        "SELECT exercise_name_snapshot FROM session_exercises",
      )
    ).rows[0].exercise_name_snapshot,
  ).toBe("historical name");
});
