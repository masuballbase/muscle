import {
  type Workout,
  type Exercise,
  prs,
  improvements,
  validSet,
} from "../training/model";
export function dayKey(iso: string | Date, timeZone = "Asia/Tokyo") {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  const value = (key: string) => parts.find((part) => part.type === key)!.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}
export function monthGrid(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Invalid month");
  const [year, number] = month.split("-").map(Number);
  const first = new Date(Date.UTC(year, number - 1, 1));
  const start = 1 - first.getUTCDay();
  return Array.from({ length: 42 }, (_, index) =>
    new Date(Date.UTC(year, number - 1, start + index))
      .toISOString()
      .slice(0, 10),
  );
}
export function historyProjection(
  workouts: Workout[],
  timeZone = "Asia/Tokyo",
) {
  const completed = workouts
    .filter((w) => w.endedAt)
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  const active = workouts.filter((w) => !w.endedAt);
  const dots = new Map<string, { synced: boolean; pending: boolean }>();
  for (const w of completed) {
    if (
      !w.sections.some((s) =>
        s.sets.some((set) => set.performed && validSet(set, s.type)),
      )
    )
      continue;
    const day = dayKey(w.startedAt, timeZone);
    const dot = dots.get(day) ?? { synced: false, pending: false };
    if (w.revision === w.syncedRevision) dot.synced = true;
    else dot.pending = true;
    dots.set(day, dot);
  }
  const formal = completed.filter((w) => w.revision === w.syncedRevision);
  return {
    completed,
    active,
    dots,
    formalPrs: prs(formal),
    forDay: (day: string) =>
      completed.filter((w) => dayKey(w.startedAt, timeZone) === day),
    prsFor: (workout: Workout) =>
      improvements(
        formal.filter(
          (w) =>
            w.id !== workout.id &&
            Date.parse(w.startedAt) < Date.parse(workout.startedAt),
        ),
        { ...workout, initialRecords: undefined },
      ),
  };
}
export function searchHistory(
  workouts: Workout[],
  query: string,
  exercises: Exercise[],
) {
  const text = query.trim().toLocaleLowerCase();
  const ids = new Set(
    exercises
      .filter((e) => e.name.toLocaleLowerCase().includes(text))
      .map((e) => e.id),
  );
  return workouts.filter(
    (w) =>
      w.endedAt &&
      (!text ||
        w.sections.some(
          (s) =>
            (ids.has(s.exerciseId) ||
              s.name.toLocaleLowerCase().includes(text)) &&
            s.sets.some((set) => set.performed && validSet(set, s.type)),
        )),
  );
}
export function editableHistory(workout: Workout) {
  return !!workout.endedAt && workout.syncedRevision === workout.revision;
}
export function validateHistory(workout: Workout) {
  if (
    !workout.name.trim() ||
    !workout.endedAt ||
    !Number.isFinite(Date.parse(workout.endedAt)) ||
    Date.parse(workout.endedAt) < Date.parse(workout.startedAt)
  )
    throw new Error("終了日時は開始日時以降、名称は空欄以外にしてください。");
  if (
    new Set(workout.sections.map((s) => s.exerciseId)).size !==
    workout.sections.length
  )
    throw new Error("種目は重複できません。");
  for (const section of workout.sections)
    for (const set of section.sets)
      if (set.performed && !validSet(set, section.type))
        throw new Error("実施済みセットの入力値を確認してください。");
}
