import {
  type Exercise,
  type Workout,
  newSet,
  previousSets,
  validSet,
} from "../training/model";
export type MenuItem = { id: string; exerciseId: string; plannedSets: number };
export type Menu = { id: string; name: string; items: MenuItem[] };
export type MenuDraft = {
  version: 1;
  id: string;
  name: string;
  items: { id: string; exerciseId: string; plannedSets: string }[];
  base: Menu | null;
};
export function availableMenu(menu: Menu, exercises: Exercise[]) {
  const items = menu.items.filter((item) =>
    exercises.some((e) => e.id === item.exerciseId && !e.archived_at),
  );
  return { ...menu, items, needsFix: items.length === 0 };
}
export function validateMenu(menu: Menu) {
  if (!menu.id || !menu.name.trim() || !menu.items.length)
    throw new Error("メニュー名と1種目以上が必要です。");
  if (
    new Set(menu.items.map((item) => item.exerciseId)).size !==
    menu.items.length
  )
    throw new Error("同じ種目は重複できません。");
  if (
    new Set(menu.items.map((item) => item.id)).size !== menu.items.length ||
    menu.items.some(
      (item) =>
        !item.id ||
        !item.exerciseId ||
        !Number.isSafeInteger(item.plannedSets) ||
        item.plannedSets < 1,
    )
  )
    throw new Error("予定セット数は1以上の整数にしてください。");
}
export function draftOf(menu?: Menu): MenuDraft {
  return {
    version: 1,
    id: menu?.id ?? crypto.randomUUID(),
    name: menu?.name ?? "",
    items:
      menu?.items.map((item) => ({
        ...item,
        plannedSets: String(item.plannedSets),
      })) ?? [],
    base: menu ? structuredClone(menu) : null,
  };
}
export function formalize(draft: MenuDraft, exercises: Exercise[]): Menu {
  const active = new Set(
    exercises.filter((e) => !e.archived_at).map((e) => e.id),
  );
  const menu = {
    id: draft.id,
    name: draft.name.trim(),
    items: draft.items
      .filter((item) => active.has(item.exerciseId))
      .map((item) => {
        if (!/^\d+$/.test(item.plannedSets))
          throw new Error("予定セット数は1以上の整数にしてください。");
        return {
          id: item.id,
          exerciseId: item.exerciseId,
          plannedSets: Number(item.plannedSets),
        };
      }),
  };
  validateMenu(menu);
  return menu;
}
export function fromHistory(workout: Workout): MenuDraft {
  if (!workout.endedAt) throw new Error("終了済み履歴を選択してください。");
  return {
    version: 1,
    id: crypto.randomUUID(),
    name: workout.name,
    base: null,
    items: workout.sections
      .map((s) => ({
        id: crypto.randomUUID(),
        exerciseId: s.exerciseId,
        plannedSets: String(
          s.sets.filter((set) => set.performed && validSet(set, s.type)).length,
        ),
      }))
      .filter((item) => Number(item.plannedSets) > 0),
  };
}
export function addDraftExercise(draft: MenuDraft, id: string): MenuDraft {
  return draft.items.some((item) => item.exerciseId === id)
    ? draft
    : {
        ...draft,
        items: [
          ...draft.items,
          { id: crypto.randomUUID(), exerciseId: id, plannedSets: "1" },
        ],
      };
}
export function reorderDraft(
  draft: MenuDraft,
  from: number,
  to: number,
): MenuDraft {
  if (
    from < 0 ||
    to < 0 ||
    from >= draft.items.length ||
    to >= draft.items.length
  )
    return draft;
  const items = [...draft.items];
  const [item] = items.splice(from, 1);
  items.splice(to, 0, item);
  return { ...draft, items };
}
export function applyMenu(
  workout: Workout,
  menu: Menu,
  exercises: Exercise[],
  history: Workout[],
): Workout {
  if (workout.endedAt) throw new Error("終了済みの記録には適用できません。");
  const available = availableMenu(menu, exercises);
  validateMenu(available);
  const sections = structuredClone(workout.sections);
  for (const item of available.items) {
    const exercise = exercises.find((e) => e.id === item.exerciseId)!;
    let section = sections.find((s) => s.exerciseId === item.exerciseId);
    if (!section) {
      section = {
        id: crypto.randomUUID(),
        exerciseId: exercise.id,
        name: exercise.name,
        type: exercise.record_type,
        sets: [],
      };
      sections.push(section);
    }
    while (section.sets.length < item.plannedSets)
      section.sets.push(
        newSet(section.type, previousSets(history, exercise.id), section.sets),
      );
  }
  return { ...workout, sections };
}
