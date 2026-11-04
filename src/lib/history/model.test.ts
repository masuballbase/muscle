import { it, expect } from "vitest";
import { newWorkout, addExercise, type Workout } from "../training/model";
import {
  dayKey,
  monthGrid,
  historyProjection,
  searchHistory,
  validateHistory,
  editableHistory,
} from "./model";
function workout(start = "2026-01-01T14:59:00Z", performed = true): Workout {
  const w = addExercise(
    newWorkout(new Date(start)),
    {
      id: "e",
      name: "snapshot name",
      record_type: "weight_reps",
      archived_at: null,
    },
    [],
  );
  w.endedAt = "2026-01-01T16:00:00Z";
  w.syncedRevision = w.revision;
  w.sections[0].sets[0] = {
    ...w.sections[0].sets[0],
    weight: "50",
    reps: "5",
    performed,
  };
  return w;
}
it("AT-013: two sessions on one day stay two sessions with one calendar dot", () => {
  const w = workout();
  const second = { ...workout("2026-01-01T14:00:00Z"), id: "second" };
  const projection = historyProjection([w, second]);
  expect(projection.forDay("2026-01-01")).toHaveLength(2);
  expect(projection.dots.size).toBe(1);
});
it("AT-014: a midnight-crossing workout belongs to its local start day", () => {
  const w = workout();
  expect(dayKey(w.startedAt)).toBe("2026-01-01");
  expect(dayKey(w.endedAt!)).toBe("2026-01-02");
  expect(historyProjection([w]).forDay("2026-01-02")).toHaveLength(0);
});
it("AT-015: zero performed sets remain in history without dots or PRs", () => {
  const projection = historyProjection([workout(undefined, false)]);
  expect(projection.completed).toHaveLength(1);
  expect(projection.dots.size).toBe(0);
  expect(projection.formalPrs).toEqual([]);
});
it("distinguishes pending completion, formal results and active resume records", () => {
  const pending = { ...workout(), syncedRevision: 0 };
  const active = { ...workout(), id: "active", endedAt: null };
  const result = historyProjection([pending, active]);
  expect(result.active).toEqual([active]);
  expect(result.completed).toEqual([pending]);
  expect(result.dots.get("2026-01-01")).toEqual({
    pending: true,
    synced: false,
  });
  expect(result.formalPrs).toEqual([]);
  expect(editableHistory(pending)).toBe(false);
});
it("searches current and snapshot names without rewriting historical names", () => {
  const w = workout();
  const masters = [
    {
      id: "e",
      name: "renamed",
      record_type: "weight_reps" as const,
      archived_at: null,
    },
  ];
  expect(searchHistory([w], "renamed", masters)).toEqual([w]);
  expect(searchHistory([w], "snapshot", masters)).toEqual([w]);
  expect(w.sections[0].name).toBe("snapshot name");
});
it("recomputes dots and PRs from edited/deleted source data", () => {
  const old = workout();
  const newer = structuredClone(workout("2026-01-02T01:00:00Z"));
  newer.id = "new";
  newer.sections[0].sets[0].weight = "80";
  const initial = historyProjection([old, newer]);
  expect(initial.formalPrs.find((p) => p.metric === "weight")?.value).toBe(80);
  const afterDelete = historyProjection([old]);
  expect(afterDelete.formalPrs.find((p) => p.metric === "weight")?.value).toBe(
    50,
  );
  expect(afterDelete.dots.has("2026-01-02")).toBe(false);
  newer.sections[0].sets = [];
  expect(
    historyProjection([old, newer]).formalPrs.find((p) => p.metric === "weight")
      ?.value,
  ).toBe(50);
});
it("AT-020: validates isolated edit copies without mutating the formal history", () => {
  const formal = workout();
  const edit = structuredClone(formal);
  edit.name = "changed";
  edit.endedAt = "2020-01-01T00:00:00Z";
  expect(() => validateHistory(edit)).toThrow();
  expect(formal.name).not.toBe("changed");
  expect(editableHistory(formal)).toBe(true);
});
it("builds a complete calendar including leap days and explicit time zones", () => {
  expect(monthGrid("2024-02")).toHaveLength(42);
  expect(monthGrid("2024-02")).toContain("2024-02-29");
  expect(dayKey("2026-01-01T23:00:00Z", "Asia/Tokyo")).toBe("2026-01-02");
  expect(dayKey("2026-01-01T23:00:00Z", "America/New_York")).toBe("2026-01-01");
});
