import { inBodyHeaders } from "../inbody/profile";
// Explicit business-data allowlists. Auth objects/localStorage are never exported.
export const columns = {
  exercises: [
    "id",
    "user_id",
    "name",
    "name_normalized",
    "record_type",
    "archived_at",
    "used_at",
    "created_at",
    "updated_at",
  ],
  menus: ["id", "user_id", "name", "created_at", "updated_at"],
  menu_items: [
    "id",
    "user_id",
    "menu_id",
    "exercise_id",
    "position",
    "planned_sets",
    "created_at",
    "updated_at",
  ],
  sessions: [
    "id",
    "user_id",
    "name",
    "started_at",
    "ended_at",
    "status",
    "revision",
    "menu_id",
    "created_at",
    "updated_at",
  ],
  session_exercises: [
    "id",
    "user_id",
    "session_id",
    "exercise_id",
    "exercise_name_snapshot",
    "record_type_snapshot",
    "position",
    "created_at",
    "updated_at",
  ],
  workout_sets: [
    "id",
    "user_id",
    "session_exercise_id",
    "record_type",
    "position",
    "weight_kg",
    "reps",
    "duration_seconds",
    "is_performed",
    "is_copied",
    "created_at",
    "updated_at",
  ],
  weekly_goal_schedule: [
    "id",
    "user_id",
    "effective_monday",
    "target_days",
    "created_at",
    "updated_at",
  ],
  inbody_records: [
    "id",
    "user_id",
    "measured_on",
    "imported_at",
    "source_filename",
    "raw_fields",
    "created_at",
    "updated_at",
  ],
} as const;
export type Table = keyof typeof columns;
export type Tables = Record<Table, Record<string, unknown>[]>;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("データ形式を確認できません。出力を中止しました。");
  return value as Record<string, unknown>;
}
function primitive(value: unknown) {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  )
    return value;
  throw new Error("未対応のデータ形式です。出力を中止しました。");
}
function pick(value: unknown, keys: readonly string[]) {
  const row = object(value);
  return Object.fromEntries(
    keys
      .filter((k) => Object.hasOwn(row, k))
      .map((k) => [k, primitive(row[k])]),
  );
}
export function sanitizeTables(
  input: unknown,
  userId: string,
): { tables: Tables; omittedColumns: Record<string, string[]> } {
  const supplied = object(input),
    out = {} as Tables,
    omittedColumns: Record<string, string[]> = {};
  for (const table of Object.keys(columns) as Table[]) {
    if (!Array.isArray(supplied[table]))
      throw new Error("全8テーブルを確認できません。");
    const omitted = new Set<string>();
    out[table] = (supplied[table] as unknown[]).map((value) => {
      const row = object(value);
      if (row.user_id !== userId || typeof row.id !== "string")
        throw new Error("出力対象ユーザーの一致を確認できません。");
      for (const key of Object.keys(row))
        if (!(columns[table] as readonly string[]).includes(key))
          omitted.add(key);
      const result: Record<string, unknown> = pick(
        Object.fromEntries(
          Object.entries(row).filter(([k]) => k !== "raw_fields"),
        ),
        columns[table].filter((k) => k !== "raw_fields"),
      );
      if (table === "inbody_records") {
        const raw = object(row.raw_fields);
        if (
          Object.keys(raw).some(
            (k) => !(inBodyHeaders as readonly string[]).includes(k),
          )
        )
          throw new Error(
            "未対応のInBody原項目があります。出力を中止しました。",
          );
        result.raw_fields = Object.fromEntries(
          Object.entries(raw).map(([k, v]) => [k, primitive(v)]),
        );
      }
      return result;
    });
    omittedColumns[table] = [...omitted].sort();
  }
  return { tables: out, omittedColumns };
}
export function exportWorkout(value: unknown): Record<string, unknown> {
  const w = object(value);
  if (
    typeof w.id !== "string" ||
    typeof w.revision !== "number" ||
    !Array.isArray(w.sections)
  )
    throw new Error("端末セッション形式を確認できません。");
  const out: Record<string, unknown> = pick(w, [
    "id",
    "name",
    "startedAt",
    "endedAt",
    "revision",
    "syncedRevision",
    "syncBlocked",
  ]);
  out.sections = w.sections.map((value) => {
    const s = object(value);
    if (
      typeof s.id !== "string" ||
      typeof s.exerciseId !== "string" ||
      !Array.isArray(s.sets)
    )
      throw new Error("端末セット形式を確認できません。");
    return {
      ...pick(s, ["id", "exerciseId", "name", "type"]),
      sets: s.sets.map((v) =>
        pick(v, ["id", "weight", "reps", "seconds", "performed", "copied"]),
      ),
    };
  });
  if (w.syncBase) out.syncBase = exportWorkout(w.syncBase);
  if (Array.isArray(w.syncAttempts))
    out.syncAttempts = w.syncAttempts.map(exportWorkout);
  return out;
}
export function exportDraft(value: unknown): Record<string, unknown> {
  const draft = object(value);
  if (
    draft.version !== 1 ||
    typeof draft.id !== "string" ||
    !Array.isArray(draft.items)
  )
    throw new Error("メニュー下書きの形式を確認できません。");
  return {
    ...pick(draft, ["version", "id", "name"]),
    items: draft.items.map((v) => pick(v, ["id", "exerciseId", "plannedSets"])),
    base: draft.base === null ? null : exportMenu(draft.base),
  };
}
function exportMenu(value: unknown) {
  const menu = object(value);
  if (!Array.isArray(menu.items))
    throw new Error("元メニューの形式を確認できません。");
  return {
    ...pick(menu, ["id", "name"]),
    items: menu.items.map((v) => pick(v, ["id", "exerciseId", "plannedSets"])),
  };
}
