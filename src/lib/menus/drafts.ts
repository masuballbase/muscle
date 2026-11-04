import type { UserStore } from "../local-store";
import type { Exercise } from "../training/model";
import type { MenuDraft } from "./model";
export async function saveMenuDraft(store: UserStore, draft: MenuDraft) {
  // Explicit fields: never store auth/session objects or workout values in menu drafts.
  await store.put("menu_drafts", draft.id, {
    version: 1,
    id: draft.id,
    name: draft.name,
    items: draft.items.map((item) => ({
      id: item.id,
      exerciseId: item.exerciseId,
      plannedSets: item.plannedSets,
    })),
    base: draft.base
      ? {
          id: draft.base.id,
          name: draft.base.name,
          items: draft.base.items.map((item) => ({
            id: item.id,
            exerciseId: item.exerciseId,
            plannedSets: item.plannedSets,
          })),
        }
      : null,
  } satisfies MenuDraft);
}
export async function loadMenuDraft(
  store: UserStore,
  id: string,
  exercises: Exercise[],
): Promise<MenuDraft | undefined> {
  const record = await store.get<MenuDraft>("menu_drafts", id);
  const draft = record?.value;
  if (
    !draft ||
    draft.version !== 1 ||
    draft.id !== id ||
    !Array.isArray(draft.items)
  )
    return;
  // Keep the original formal snapshot for server conflict detection; remove archived choices from the draft.
  const active = new Set(
    exercises.filter((e) => !e.archived_at).map((e) => e.id),
  );
  return {
    ...draft,
    items: draft.items.filter((item) => active.has(item.exerciseId)),
    base: draft.base
      ? {
          ...draft.base,
          items: draft.base.items.filter((item) => active.has(item.exerciseId)),
        }
      : null,
  };
}
