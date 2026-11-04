export type RecordType = "weight_reps" | "reps" | "duration";
export const typeLabels: Record<RecordType, string> = {
  weight_reps: "重量＋回数",
  reps: "回数のみ",
  duration: "時間のみ",
};
export type Exercise = {
  id: string;
  name: string;
  record_type: RecordType;
  archived_at: string | null;
};
export type SetRecord = {
  id: string;
  weight: string;
  reps: string;
  seconds: string;
  performed: boolean;
  copied: boolean;
};
export type Section = {
  id: string;
  exerciseId: string;
  name: string;
  type: RecordType;
  sets: SetRecord[];
};
export type Workout = {
  id: string;
  name: string;
  startedAt: string;
  endedAt: string | null;
  sections: Section[];
  revision: number;
  syncedRevision: number;
  committedPrs?: PR[];
  initialRecords?: (PR & { setId: string })[];
};
export type PR = {
  exerciseId: string;
  name: string;
  metric: "weight" | "oneRM" | "reps" | "seconds";
  value: number;
};
export const metricLabels = {
  weight: "最大使用重量",
  oneRM: "推定1RM",
  reps: "1セット最多回数",
  seconds: "1セット最長時間",
};
export function newWorkout(now = new Date()): Workout {
  return {
    id: crypto.randomUUID(),
    name: `トレーニング ${new Intl.DateTimeFormat("ja-JP", { dateStyle: "short", timeStyle: "short" }).format(now)}`,
    startedAt: now.toISOString(),
    endedAt: null,
    sections: [],
    revision: 1,
    syncedRevision: 0,
  };
}
export function validNumber(value: string, integer: boolean, min: number) {
  if (!value.trim() || !(integer ? /^\d+$/ : /^\d+(?:\.\d+)?$/).test(value))
    return false;
  const n = Number(value);
  return Number.isFinite(n) && n >= min && (!integer || Number.isInteger(n));
}
export function validSet(set: SetRecord, type: RecordType) {
  return type === "duration"
    ? validNumber(set.seconds, true, 1)
    : validNumber(set.reps, true, 1) &&
        (type !== "weight_reps" || validNumber(set.weight, false, 0));
}
export function changeSet(
  set: SetRecord,
  field: "weight" | "reps" | "seconds",
  value: string,
  type: RecordType,
): SetRecord {
  const next = { ...set, [field]: value };
  return { ...next, performed: set.performed && validSet(next, type) };
}
export function confirmSet(
  set: SetRecord,
  type: RecordType,
  explicit = false,
): SetRecord {
  return {
    ...set,
    copied: explicit ? false : set.copied,
    performed:
      validSet(set, type) && (set.performed || explicit || !set.copied),
  };
}
export function previousSets(
  history: Workout[],
  exerciseId: string,
): SetRecord[] {
  const last = history
    .filter(
      (w) =>
        w.endedAt &&
        w.syncedRevision === w.revision &&
        w.sections.some(
          (s) =>
            s.exerciseId === exerciseId && s.sets.some((set) => set.performed),
        ),
    )
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))[0];
  return (
    last?.sections
      .find((s) => s.exerciseId === exerciseId)
      ?.sets.filter((set) => set.performed) ?? []
  );
}
export function newSet(
  type: RecordType,
  previous: SetRecord[],
  existing: SetRecord[],
): SetRecord {
  return {
    id: crypto.randomUUID(),
    weight:
      type === "weight_reps"
        ? (previous[existing.length]?.weight ?? existing.at(-1)?.weight ?? "")
        : "",
    reps: "",
    seconds: "",
    performed: false,
    copied: false,
  };
}
export function copySet(set: SetRecord): SetRecord {
  return { ...set, id: crypto.randomUUID(), performed: false, copied: true };
}
export function addExercise(
  workout: Workout,
  exercise: Exercise,
  history: Workout[],
): Workout {
  const sections = structuredClone(workout.sections);
  let section = sections.find((s) => s.exerciseId === exercise.id);
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
  section.sets.push(
    newSet(section.type, previousSets(history, exercise.id), section.sets),
  );
  return { ...workout, sections };
}
export function prs(workouts: Workout[]): PR[] {
  const best = new Map<string, PR>();
  for (const w of workouts)
    for (const s of w.sections)
      for (const set of s.sets) {
        if (!set.performed || !validSet(set, s.type)) continue;
        const values: Partial<Record<PR["metric"], number>> =
          s.type === "duration"
            ? { seconds: Number(set.seconds) }
            : s.type === "reps"
              ? { reps: Number(set.reps) }
              : {
                  weight: Number(set.weight),
                  ...(Number(set.reps) <= 10
                    ? {
                        oneRM:
                          Number(set.reps) === 1
                            ? Number(set.weight)
                            : Number(set.weight) * (1 + Number(set.reps) / 30),
                      }
                    : {}),
                };
        for (const [metric, value] of Object.entries(values)) {
          const key = `${s.exerciseId}:${metric}`;
          if (!best.has(key) || best.get(key)!.value < value)
            best.set(key, {
              exerciseId: s.exerciseId,
              name: s.name,
              metric: metric as PR["metric"],
              value,
            });
        }
      }
  return [...best.values()];
}
export function improvements(baseline: Workout[], current: Workout): PR[] {
  const old = [...prs(baseline), ...(current.initialRecords ?? [])];
  return prs([current]).filter((p) => {
    const before = old.find(
      (b) => b.exerciseId === p.exerciseId && b.metric === p.metric,
    );
    return before !== undefined && p.value > before.value;
  });
}
export function summary(workout: Workout, baseline: Workout[]) {
  return {
    seconds: Math.max(
      0,
      Math.floor(
        (Date.parse(workout.endedAt ?? workout.startedAt) -
          Date.parse(workout.startedAt)) /
          1000,
      ),
    ),
    exercises: workout.sections.filter((s) =>
      s.sets.some((set) => set.performed),
    ).length,
    sets: workout.sections.flatMap((s) => s.sets).filter((set) => set.performed)
      .length,
    prs: improvements(baseline, workout),
  };
}
export function finish(workout: Workout, now = new Date()): Workout {
  if (workout.endedAt) return workout;
  return {
    ...workout,
    endedAt: now.toISOString(),
    sections: workout.sections.map((s) => ({
      ...s,
      sets: s.sets.filter((set) => set.performed && validSet(set, s.type)),
    })),
  };
}
