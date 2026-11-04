import { it, expect, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { openUserStore } from "../local-store";
import { newWorkout, addExercise, type Exercise } from "../training/model";
import {
  applyMenu,
  draftOf,
  formalize,
  fromHistory,
  availableMenu,
  addDraftExercise,
  reorderDraft,
  type Menu,
} from "./model";
import { saveMenuDraft, loadMenuDraft } from "./drafts";
const exercise = (id: string): Exercise => ({
  id,
  name: id,
  record_type: "weight_reps",
  archived_at: null,
});
const exercises = [exercise("a"), exercise("b"), exercise("c")];
const menu: Menu = {
  id: "menu",
  name: "training",
  items: [
    { id: "item", exerciseId: "a", plannedSets: 5 },
    { id: "new", exerciseId: "c", plannedSets: 2 },
  ],
};
it("AT-006: counts unperformed rows and adds only missing sets; repeated application is idempotent", () => {
  let w = newWorkout();
  for (let n = 0; n < 3; n++) w = addExercise(w, exercises[0], []);
  w.sections[0].sets[0].performed = true;
  const applied = applyMenu(w, menu, exercises, []);
  expect(applied.sections[0].sets).toHaveLength(5);
  expect(applyMenu(applied, menu, exercises, [])).toEqual(applied);
  expect(w.sections[0].sets).toHaveLength(3);
  expect(menu.items[0].plannedSets).toBe(5);
});
it("preserves section order and historical names, appending only new exercises", () => {
  let w = addExercise(newWorkout(), exercises[1], []);
  w = addExercise(w, { ...exercises[0], name: "snapshot" }, []);
  const applied = applyMenu(w, menu, exercises, []);
  expect(applied.sections.map((s) => s.exerciseId)).toEqual(["b", "a", "c"]);
  expect(applied.sections[1].name).toBe("snapshot");
});
it("builds history-derived menus from performed rows only and stores no workout values", () => {
  const w = addExercise(newWorkout(), exercises[0], []);
  w.sections[0].sets = [
    {
      id: "s",
      weight: "50",
      reps: "5",
      seconds: "",
      performed: true,
      copied: false,
    },
    {
      id: "unperformed",
      weight: "90",
      reps: "2",
      seconds: "",
      performed: false,
      copied: false,
    },
  ];
  w.endedAt = new Date().toISOString();
  w.syncedRevision = w.revision;
  const draft = fromHistory(w);
  expect(draft.items[0].plannedSets).toBe("1");
  expect(Object.keys(draft.items[0]).sort()).toEqual([
    "exerciseId",
    "id",
    "plannedSets",
  ]);
  expect(() => fromHistory({ ...w, endedAt: null })).toThrow();
});
it("AT-007/008: restores independent menu drafts across reopen without changing formal menus", async () => {
  const factory = new IDBFactory();
  let store = await openUserStore("a", factory);
  const first = draftOf(menu);
  first.name = "local only";
  const second = draftOf({ ...menu, id: "other" });
  second.items[0].plannedSets = "9";
  await saveMenuDraft(store, first);
  await saveMenuDraft(store, second);
  store.close();
  store = await openUserStore("a", factory);
  expect((await loadMenuDraft(store, "menu", exercises))?.name).toBe(
    "local only",
  );
  expect(
    (await loadMenuDraft(store, "other", exercises))?.items[0].plannedSets,
  ).toBe("9");
  expect(menu.name).toBe("training");
  await store.remove("menu_drafts", "menu");
  expect(await loadMenuDraft(store, "menu", exercises)).toBeUndefined();
  expect(await loadMenuDraft(store, "other", exercises)).toBeDefined();
  store.close();
});
it("AT-011: excludes archived items; empty menus remain present and inapplicable", async () => {
  const archived = exercises.map((e) => ({
    ...e,
    archived_at: new Date().toISOString(),
  }));
  const available = availableMenu(menu, archived);
  expect(available).toMatchObject({ id: "menu", needsFix: true, items: [] });
  expect(() => applyMenu(newWorkout(), menu, archived, [])).toThrow();
  const store = await openUserStore("a", new IDBFactory());
  await saveMenuDraft(store, draftOf(menu));
  expect((await loadMenuDraft(store, "menu", archived))?.items).toEqual([]);
  store.close();
});
it("rejects invalid formal menus but permits incomplete local drafts", async () => {
  const store = await openUserStore("a", new IDBFactory());
  const draft = draftOf();
  await saveMenuDraft(store, draft);
  expect(() => formalize(draft, exercises)).toThrow();
  const invalid = {
    ...draftOf(menu),
    items: [{ id: "x", exerciseId: "a", plannedSets: "1.5" }],
  };
  expect(() => formalize(invalid, exercises)).toThrow();
  store.close();
});
it("does not duplicate draft exercises and reorders without editing the saved menu", () => {
  const draft = draftOf(menu);
  expect(addDraftExercise(draft, "a")).toBe(draft);
  expect(reorderDraft(draft, 1, 0).items.map((i) => i.exerciseId)).toEqual([
    "c",
    "a",
  ]);
  expect(menu.items.map((i) => i.exerciseId)).toEqual(["a", "c"]);
});
it("isolates drafts between accounts and propagates device failures without changing formal data", async () => {
  const factory = new IDBFactory();
  const a = await openUserStore("a", factory);
  const b = await openUserStore("b", factory);
  await saveMenuDraft(a, draftOf(menu));
  expect(await loadMenuDraft(b, "menu", exercises)).toBeUndefined();
  const spy = vi.spyOn(a, "put").mockRejectedValue(new Error("quota"));
  await expect(
    saveMenuDraft(a, { ...draftOf(menu), name: "failed" }),
  ).rejects.toThrow("quota");
  spy.mockRestore();
  expect((await loadMenuDraft(a, "menu", exercises))?.name).toBe(menu.name);
  a.close();
  b.close();
});
it("rebases archived-item removal in a draft snapshot without concealing other formal changes", async () => {
  const store = await openUserStore("a", new IDBFactory());
  await saveMenuDraft(store, draftOf(menu));
  const masters = exercises.map((e) =>
    e.id === "a" ? { ...e, archived_at: new Date().toISOString() } : e,
  );
  const draft = await loadMenuDraft(store, "menu", masters);
  expect(draft?.items.map((item) => item.exerciseId)).toEqual(["c"]);
  expect(draft?.base?.items.map((item) => item.exerciseId)).toEqual(["c"]);
  expect(draft?.base?.name).toBe(menu.name);
  store.close();
});
