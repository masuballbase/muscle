import { describe, it, expect } from "vitest";
import {
  formalWorkouts,
  overallAnalysis,
  weeklyProgress,
  exerciseAnalysis,
  nextMonday,
  periodStart,
  monday,
  exerciseCatalog,
  type Goal,
} from "./model";
import {
  type Workout,
  type RecordType,
  type SetRecord,
  improvements,
} from "../training/model";
const now = new Date("2026-11-04T03:00:00Z"),
  tz = "Asia/Tokyo";
const row = (
  weight = "50",
  reps = "5",
  seconds = "30",
  performed = true,
): SetRecord => ({
  id: crypto.randomUUID(),
  weight,
  reps,
  seconds,
  performed,
  copied: false,
});
function workout(
  startedAt = "2026-11-03T01:00:00Z",
  type: RecordType = "weight_reps",
  sets = [row()],
): Workout {
  return {
    id: crypto.randomUUID(),
    name: "fixture",
    startedAt,
    endedAt: new Date(Date.parse(startedAt) + 7200000).toISOString(),
    revision: 1,
    syncedRevision: 1,
    sections: [
      {
        id: crypto.randomUUID(),
        exerciseId: "exercise",
        name: "当時の名前",
        type,
        sets,
      },
    ],
  };
}
const goal = (effective_monday: string, target_days: number): Goal => ({
  id: crypto.randomUUID(),
  effective_monday,
  target_days,
});
describe("AN-001–011 overall and goals / AT-013–016,019", () => {
  it("counts two sessions on one start day as one day and two exercise occurrences", () => {
    const a = workout(),
      b = workout("2026-11-03T14:50:00Z");
    const p = overallAnalysis([a, b], [], "month", now, tz);
    expect([p.days, p.sessions, p.ranking[0].count]).toEqual([1, 2, 2]);
    expect(p.bars.reduce((n, b) => n + b.value, 0)).toBe(1);
  });
  it("excludes active, unsynced, zero, unperformed and invalid sets, deduplicates IDs", () => {
    const a = workout(),
      pending = { ...workout(), revision: 2 },
      active = { ...workout(), endedAt: null };
    const zero = workout(undefined, "reps", []),
      blank = workout(undefined, "reps", [row("", "", "", true)]),
      copied = workout(undefined, "reps", [row("", "5", "", false)]);
    expect(
      formalWorkouts([a, a, pending, active, zero, blank, copied]),
    ).toEqual([a]);
    expect(formalWorkouts([a, { ...a, revision: 2 }])).toHaveLength(0);
  });
  it("uses local start date over end date, including timezone boundaries", () => {
    const a = workout("2026-11-01T15:05:00Z"),
      goals = [goal("2026-10-26", 1)];
    expect(weeklyProgress([a], goals, now, tz).days).toBe(1);
    expect(weeklyProgress([a], goals, now, "America/Los_Angeles").days).toBe(0);
  });
  it("clamps rolling calendar periods for leap years and month-end", () => {
    expect(periodStart("month", new Date("2024-03-31T01:00:00Z"), tz)).toBe(
      "2024-02-29",
    );
    expect(periodStart("quarter", now, tz)).toBe("2026-08-04");
    expect(periodStart("half", now, tz)).toBe("2026-05-04");
    expect(periodStart("year", now, tz)).toBe("2025-11-04");
    expect(periodStart("all", now, tz)).toBeNull();
  });
  it("applies period to counts and ranking, not current weekly metrics", () => {
    const ws = [workout(), workout("2026-01-01T01:00:00Z")];
    expect(overallAnalysis(ws, [], "month", now, tz).sessions).toBe(1);
    expect(overallAnalysis(ws, [], "all", now, tz).sessions).toBe(2);
    expect(weeklyProgress(ws, [goal("2026-01-05", 1)], now, tz)).toMatchObject({
      days: 1,
      rate: 100,
      streak: 1,
    });
  });
  it("does not count a section twice per session", () => {
    const a = workout();
    a.sections.push({ ...a.sections[0], id: "duplicate" });
    expect(overallAnalysis([a], [], "all", now, tz).ranking[0].count).toBe(1);
  });
  it("uses Monday civil dates across DST and year rollover", () => {
    expect(monday("2026-01-01")).toBe("2025-12-29");
    expect(
      nextMonday(new Date("2026-11-02T00:30:00Z"), "America/Los_Angeles"),
    ).toBe("2026-11-02");
    expect(nextMonday(new Date("2026-11-02T00:30:00Z"), tz)).toBe("2026-11-09");
  });
  it("leaves current goal/streak undefined when only next week is set", () => {
    expect(
      weeklyProgress([workout()], [goal("2026-11-09", 3)], now, tz),
    ).toMatchObject({ target: undefined, rate: undefined, streak: undefined });
  });
  it("keeps previous streak during an unfinished week and breaks after missed full week", () => {
    const goals = [goal("2026-10-19", 1)];
    const ws = [
      workout("2026-10-20T00:00:00Z"),
      workout("2026-10-27T00:00:00Z"),
    ];
    expect(weeklyProgress(ws, goals, now, tz).streak).toBe(2);
    expect(
      weeklyProgress(ws, goals, new Date("2026-11-09T03:00:00Z"), tz).streak,
    ).toBe(0);
  });
  it("uses historic targets, includes achieved current week, and exceeds 100%", () => {
    const goals = [
      goal("2026-10-19", 1),
      goal("2026-10-26", 2),
      goal("2026-11-02", 1),
      goal("2026-11-09", 7),
    ];
    const ws = [
      "2026-10-20",
      "2026-10-27",
      "2026-10-28",
      "2026-11-02",
      "2026-11-03",
    ].map((d) => workout(`${d}T01:00:00Z`));
    expect(weeklyProgress(ws, goals, now, tz)).toMatchObject({
      target: 1,
      days: 2,
      rate: 200,
      streak: 3,
    });
    expect(
      weeklyProgress(
        ws.filter((w) => !w.startedAt.startsWith("2026-10-28")),
        goals,
        now,
        tz,
      ).streak,
    ).toBe(1);
  });
});
describe("AN-012–025 growth / AT-017,018", () => {
  it("computes Epley only for reps 2–10, uses actual weight for 1, excludes 11+", () => {
    const ws = [
      workout(undefined, "weight_reps", [
        row("100", "1"),
        row("90", "10"),
        row("1000", "11"),
        row("100", "2"),
      ]),
    ];
    expect(
      exerciseAnalysis(ws, "exercise", "all", "oneRM", null, now, tz).points[0]
        .value,
    ).toBe(120);
    expect(
      exerciseAnalysis(
        [workout(undefined, "weight_reps", [row("100", "1")])],
        "exercise",
        "all",
        "oneRM",
        null,
        now,
        tz,
      ).points[0].value,
    ).toBe(100);
    expect(
      exerciseAnalysis(
        [workout(undefined, "weight_reps", [row("100", "11")])],
        "exercise",
        "all",
        "oneRM",
        null,
        now,
        tz,
      ).points,
    ).toHaveLength(0);
  });
  it("keeps same-day sessions as separate chronologically sorted points", () => {
    const a = workout("2026-11-03T01:00:00Z"),
      b = workout("2026-11-03T05:00:00Z");
    expect(
      exerciseAnalysis(
        [b, a],
        "exercise",
        "all",
        "weight",
        null,
        now,
        tz,
      ).points.map((p) => p.id),
    ).toEqual([a.id, b.id]);
  });
  it("filters same-weight reps per session without fabricating missing points", () => {
    const a = workout(undefined, "weight_reps", [
      row("50", "4"),
      row("50", "8"),
      row("60", "12"),
    ]);
    expect(
      exerciseAnalysis([a], "exercise", "all", "sameWeightReps", 50, now, tz)
        .points[0].value,
    ).toBe(8);
    expect(
      exerciseAnalysis([a], "exercise", "all", "sameWeightReps", 55, now, tz)
        .points,
    ).toEqual([]);
  });
  it.each([
    ["reps", "reps", 8],
    ["reps", "totalReps", 13],
    ["duration", "seconds", 50],
    ["duration", "totalSeconds", 80],
  ] as const)("%s / %s counts performed sets only", (type, metric, value) => {
    const a = workout(undefined, type, [
      row("", "5", "30"),
      row("", "8", "50"),
      row("", "100", "100", false),
    ]);
    expect(
      exerciseAnalysis([a], "exercise", "all", metric, null, now, tz).points[0]
        .value,
    ).toBe(value);
  });
  it("renames/archives by ID but retains old snapshots and searches historic names", () => {
    const ws = [workout()],
      master = [
        {
          id: "exercise",
          name: "新しい名前",
          record_type: "weight_reps" as const,
          archived_at: now.toISOString(),
        },
      ];
    const catalog = exerciseCatalog(ws, master);
    expect(catalog[0]).toMatchObject({ name: "新しい名前", archived: true });
    expect(catalog[0].aliases).toContain("当時の名前");
    expect(ws[0].sections[0].name).toBe("当時の名前");
    expect(exerciseCatalog(ws, [])[0].name).toBe("当時の名前");
  });
  it("recomputes PR, points and counts after editing/deleting; initial/tied PRs never notify", () => {
    const low = workout(undefined, "weight_reps", [row("50", "5")]),
      high = workout(undefined, "weight_reps", [row("80", "5")]);
    const project = (ws: Workout[]) =>
      exerciseAnalysis(ws, "exercise", "all", "weight", null, now, tz);
    expect(
      project([low, high]).prs.find((p) => p.metric === "weight")?.value,
    ).toBe(80);
    expect(project([low]).prs.find((p) => p.metric === "weight")?.value).toBe(
      50,
    );
    expect(project([]).prs).toEqual([]);
    expect(
      project([
        {
          ...high,
          sections: [{ ...high.sections[0], sets: [row("40", "5")] }],
        },
      ]).points[0].value,
    ).toBe(40);
    expect(improvements([], low)).toEqual([]);
    expect(improvements([low], low)).toEqual([]);
  });
  it("returns no synthetic points for zero data and one point for one session", () => {
    expect(
      exerciseAnalysis([], "exercise", "all", "weight", null, now, tz).points,
    ).toEqual([]);
    expect(
      exerciseAnalysis([workout()], "exercise", "all", "weight", null, now, tz)
        .points,
    ).toHaveLength(1);
  });
});
