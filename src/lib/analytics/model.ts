import { dayKey } from "../history/model";
import {
  type Workout,
  type Exercise,
  type RecordType,
  validSet,
  prs,
} from "../training/model";
export type Goal = {
  id: string;
  effective_monday: string;
  target_days: number;
};
export const periods = {
  month: "1か月",
  quarter: "3か月",
  half: "6か月",
  year: "1年",
  all: "全期間",
} as const;
export type Period = keyof typeof periods;
export const chartMetrics = {
  weight: "最大使用重量",
  sameWeightReps: "同一重量での最大回数",
  oneRM: "推定1RM",
  reps: "1セット最多回数",
  totalReps: "1セッション合計回数",
  seconds: "1セット最長時間",
  totalSeconds: "1セッション合計時間",
} as const;
export type ChartMetric = keyof typeof chartMetrics;
export const metricsFor: Record<RecordType, ChartMetric[]> = {
  weight_reps: ["weight", "sameWeightReps", "oneRM"],
  reps: ["reps", "totalReps"],
  duration: ["seconds", "totalSeconds"],
};
// Civil dates use UTC arithmetic only as a calendar, never as a user's midnight.
export function addDays(day: string, days: number) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
export function monday(day: string) {
  return addDays(day, -((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7));
}
export function nextMonday(now: Date, timeZone: string) {
  return addDays(monday(dayKey(now, timeZone)), 7);
}
export function periodStart(period: Period, now: Date, timeZone: string) {
  if (period === "all") return null;
  const [y, m, d] = dayKey(now, timeZone).split("-").map(Number);
  const months = { month: 1, quarter: 3, half: 6, year: 12 }[period];
  const first = new Date(Date.UTC(y, m - 1 - months, 1));
  const last = new Date(
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0),
  ).getUTCDate();
  first.setUTCDate(Math.min(d, last));
  return first.toISOString().slice(0, 10);
}
export function formalWorkouts(workouts: Workout[]) {
  // De-duplicate by stable ID; a newer unsynced version must not expose an older copy.
  const latest = new Map<string, Workout>();
  for (const w of workouts) {
    const old = latest.get(w.id);
    if (!old || old.revision <= w.revision) latest.set(w.id, w);
  }
  return [...latest.values()]
    .filter(
      (w) =>
        w.endedAt &&
        w.revision === w.syncedRevision &&
        w.sections.some((s) =>
          s.sets.some((set) => set.performed && validSet(set, s.type)),
        ),
    )
    .sort(
      (a, b) =>
        Date.parse(a.startedAt) - Date.parse(b.startedAt) ||
        a.id.localeCompare(b.id),
    );
}
export function inPeriod(
  workouts: Workout[],
  period: Period,
  now: Date,
  timeZone: string,
) {
  const start = periodStart(period, now, timeZone);
  return formalWorkouts(workouts).filter(
    (w) =>
      (!start || dayKey(w.startedAt, timeZone) >= start) &&
      Date.parse(w.startedAt) <= now.getTime(),
  );
}
export function goalFor(goals: Goal[], week: string) {
  return [...goals]
    .filter((g) => g.effective_monday <= week)
    .sort((a, b) => b.effective_monday.localeCompare(a.effective_monday))[0]
    ?.target_days;
}
export function weeklyProgress(
  workouts: Workout[],
  goals: Goal[],
  now: Date,
  timeZone: string,
) {
  const week = monday(dayKey(now, timeZone));
  const days = new Map<string, Set<string>>();
  for (const w of inPeriod(workouts, "all", now, timeZone)) {
    const day = dayKey(w.startedAt, timeZone),
      key = monday(day);
    const entries = days.get(key) ?? new Set<string>();
    entries.add(day);
    days.set(key, entries);
  }
  const target = goalFor(goals, week);
  const count = days.get(week)?.size ?? 0;
  if (target === undefined)
    return { week, days: count, target, rate: undefined, streak: undefined };
  let cursor = count >= target ? week : addDays(week, -7),
    streak = 0;
  for (;;) {
    const historicTarget = goalFor(goals, cursor);
    if (
      historicTarget === undefined ||
      (days.get(cursor)?.size ?? 0) < historicTarget
    )
      break;
    streak++;
    cursor = addDays(cursor, -7);
  }
  return { week, days: count, target, rate: (count / target) * 100, streak };
}
export function exerciseCatalog(workouts: Workout[], exercises: Exercise[]) {
  const result = new Map<
    string,
    {
      id: string;
      name: string;
      type: RecordType;
      archived: boolean;
      aliases: string[];
    }
  >();
  for (const w of formalWorkouts(workouts))
    for (const s of w.sections) {
      const old = result.get(s.exerciseId);
      result.set(s.exerciseId, {
        id: s.exerciseId,
        name: s.name,
        type: s.type,
        archived: true,
        aliases: [...(old?.aliases ?? []), s.name],
      });
    }
  for (const e of exercises) {
    const old = result.get(e.id);
    result.set(e.id, {
      id: e.id,
      name: e.name,
      type: e.record_type,
      archived: !!e.archived_at,
      aliases: [...(old?.aliases ?? []), e.name],
    });
  }
  return [...result.values()].sort((a, b) =>
    a.name.localeCompare(b.name, "ja"),
  );
}
export function overallAnalysis(
  workouts: Workout[],
  exercises: Exercise[],
  period: Period,
  now: Date,
  timeZone: string,
) {
  const selected = inPeriod(workouts, period, now, timeZone);
  const days = new Set(selected.map((w) => dayKey(w.startedAt, timeZone)));
  const counts = new Map<string, number>();
  for (const w of selected) {
    const ids = new Set(
      w.sections
        .filter((s) =>
          s.sets.some((set) => set.performed && validSet(set, s.type)),
        )
        .map((s) => s.exerciseId),
    );
    for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const catalog = exerciseCatalog(workouts, exercises);
  const ranking = catalog
    .filter((e) => counts.has(e.id))
    .map((e) => ({ ...e, count: counts.get(e.id)! }))
    .sort(
      (a, b) =>
        b.count - a.count ||
        a.name.localeCompare(b.name, "ja") ||
        a.id.localeCompare(b.id),
    );
  const weekly = period === "month" || period === "quarter";
  const bucket = (day: string) => (weekly ? monday(day) : day.slice(0, 7));
  const start =
    periodStart(period, now, timeZone) ??
    (days.size ? [...days].sort()[0] : dayKey(now, timeZone));
  const end = dayKey(now, timeZone),
    buckets = new Map<string, number>();
  let cursor = bucket(start);
  const last = bucket(end);
  while (cursor <= last) {
    buckets.set(cursor, 0);
    cursor = weekly
      ? addDays(cursor, 7)
      : new Date(
          Date.UTC(Number(cursor.slice(0, 4)), Number(cursor.slice(5, 7)), 1),
        )
          .toISOString()
          .slice(0, 7);
  }
  for (const day of days)
    buckets.set(bucket(day), (buckets.get(bucket(day)) ?? 0) + 1);
  return {
    days: days.size,
    sessions: selected.length,
    ranking,
    weekly,
    bars: [...buckets].map(([label, value]) => ({ label, value })),
  };
}
export function exerciseAnalysis(
  workouts: Workout[],
  exerciseId: string,
  period: Period,
  metric: ChartMetric,
  selectedWeight: number | null,
  now: Date,
  timeZone: string,
) {
  const formal = inPeriod(workouts, "all", now, timeZone);
  const weights = [
    ...new Set(
      formal.flatMap((w) =>
        w.sections
          .filter(
            (s) => s.exerciseId === exerciseId && s.type === "weight_reps",
          )
          .flatMap((s) =>
            s.sets
              .filter((set) => set.performed && validSet(set, s.type))
              .map((set) => Number(set.weight)),
          ),
      ),
    ),
  ].sort((a, b) => a - b);
  const points = inPeriod(formal, period, now, timeZone).flatMap((w) => {
    const values: number[] = [];
    for (const s of w.sections.filter((s) => s.exerciseId === exerciseId)) {
      if (!metricsFor[s.type].includes(metric)) continue;
      for (const set of s.sets.filter(
        (set) => set.performed && validSet(set, s.type),
      )) {
        if (metric === "weight") values.push(Number(set.weight));
        if (
          metric === "sameWeightReps" &&
          selectedWeight !== null &&
          Number(set.weight) === selectedWeight
        )
          values.push(Number(set.reps));
        if (metric === "oneRM" && Number(set.reps) <= 10)
          values.push(
            Number(set.reps) === 1
              ? Number(set.weight)
              : Number(set.weight) * (1 + Number(set.reps) / 30),
          );
        if (metric === "reps" || metric === "totalReps")
          values.push(Number(set.reps));
        if (metric === "seconds" || metric === "totalSeconds")
          values.push(Number(set.seconds));
      }
    }
    if (!values.length) return [];
    return [
      {
        id: w.id,
        startedAt: w.startedAt,
        name: w.name,
        value:
          metric === "totalReps" || metric === "totalSeconds"
            ? values.reduce((a, b) => a + b, 0)
            : Math.max(...values),
      },
    ];
  });
  return {
    points,
    weights,
    prs: prs(formal).filter((p) => p.exerciseId === exerciseId),
  };
}
