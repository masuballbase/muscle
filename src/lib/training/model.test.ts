import { describe, it, expect } from "vitest";
import {
  newWorkout,
  addExercise,
  newSet,
  changeSet,
  confirmSet,
  copySet,
  finish,
  previousSets,
  prs,
  improvements,
  summary,
  validSet,
  type SetRecord,
  type Workout,
} from "./model";
const set = (patch: Partial<SetRecord> = {}): SetRecord => ({
  id: crypto.randomUUID(),
  weight: "50",
  reps: "5",
  seconds: "",
  performed: true,
  copied: false,
  ...patch,
});
const workout = (
  sets: SetRecord[],
  type: "weight_reps" | "reps" | "duration" = "weight_reps",
): Workout => ({
  ...newWorkout(new Date("2026-01-01T01:00:00Z")),
  endedAt: "2026-01-01T01:10:00Z",
  syncedRevision: 1,
  sections: [
    { id: "section", exerciseId: "exercise", name: "当時の種目名", type, sets },
  ],
});
describe("set entry lifecycle", () => {
  it("does not perform incomplete/keystroke entries; commits on blur", () => {
    let s = set({ weight: "", reps: "", performed: false });
    s = changeSet(s, "weight", "0", "weight_reps");
    s = changeSet(s, "reps", "3", "weight_reps");
    expect(s.performed).toBe(false);
    expect(confirmSet(s, "weight_reps").performed).toBe(true);
  });
  it("keeps copied sets pending across edits until explicit confirmation", () => {
    let s = copySet(set());
    s = changeSet(s, "reps", "8", "weight_reps");
    expect(confirmSet(s, "weight_reps").performed).toBe(false);
    s = confirmSet(s, "weight_reps", true);
    expect(s.performed).toBe(true);
    expect(changeSet(s, "weight", "60", "weight_reps").performed).toBe(true);
    s = changeSet(s, "reps", "", "weight_reps");
    expect(s.performed).toBe(false);
    s = changeSet(s, "reps", "4", "weight_reps");
    expect(confirmSet(s, "weight_reps").performed).toBe(true);
  });
  it.each(["-1", "0", "1.0", "1.2", "NaN", "Infinity", "1e3"])(
    "rejects invalid reps %s",
    (value) =>
      expect(validSet(set({ reps: value }), "weight_reps")).toBe(false),
  );
  it("allows decimal/zero weight and requires integer positive seconds", () => {
    expect(validSet(set({ weight: "0.25" }), "weight_reps")).toBe(true);
    expect(
      validSet(set({ seconds: "1", weight: "", reps: "" }), "duration"),
    ).toBe(true);
    expect(validSet(set({ seconds: "1.5" }), "duration")).toBe(false);
  });
});
describe("previous values and sessions", () => {
  it("uses the latest completed performed session, not pending/newer empty records", () => {
    const old = workout([set(), set({ performed: false })]);
    const newer = {
      ...workout([set({ weight: "99" })]),
      startedAt: "2026-01-02T00:00:00Z",
      syncedRevision: 0,
    };
    expect(previousSets([old, newer], "exercise").map((s) => s.weight)).toEqual(
      ["50"],
    );
  });
  it("uses corresponding previous weight then previous row weight; reps stay blank", () => {
    expect(newSet("weight_reps", [set({ weight: "70" })], []).weight).toBe(
      "70",
    );
    expect(newSet("weight_reps", [], [set({ weight: "80" })])).toMatchObject({
      weight: "80",
      reps: "",
      performed: false,
    });
  });
  it("adds a row to an existing section instead of duplicating it", () => {
    const exercise = {
      id: "exercise",
      name: "current",
      record_type: "weight_reps" as const,
      archived_at: null,
    };
    const w = addExercise(
      addExercise(newWorkout(), exercise, []),
      exercise,
      [],
    );
    expect(w.sections).toHaveLength(1);
    expect(w.sections[0].sets).toHaveLength(2);
  });
  it("fixes end time, excludes unperformed sets, permits zero sets", () => {
    const w = { ...workout([set({ performed: false })]), endedAt: null };
    const ended = finish(w, new Date("2026-01-01T01:05:00Z"));
    expect(ended.sections[0].sets).toHaveLength(0);
    expect(finish(ended, new Date("2026-01-02")).endedAt).toBe(ended.endedAt);
    expect(summary(ended, [])).toMatchObject({
      seconds: 300,
      exercises: 0,
      sets: 0,
    });
  });
});
describe("personal records", () => {
  it("uses Epley for 2-10, actual weight for 1, and excludes 11+", () => {
    expect(
      prs([workout([set({ weight: "60", reps: "1" })])]).find(
        (p) => p.metric === "oneRM",
      )?.value,
    ).toBe(60);
    expect(
      prs([workout([set({ reps: "6" })])]).find((p) => p.metric === "oneRM")
        ?.value,
    ).toBe(60);
    expect(
      prs([workout([set({ reps: "11" })])]).some((p) => p.metric === "oneRM"),
    ).toBe(false);
  });
  it("does not notify for initial records, ties or unperformed entries", () => {
    const w = workout([set()]);
    expect(improvements([], w)).toEqual([]);
    expect(improvements([w], w)).toEqual([]);
    expect(
      improvements([w], workout([set({ weight: "90", performed: false })])),
    ).toEqual([]);
  });
  it("recomputes updates and removal, and limits PR metrics by record type", () => {
    const old = workout([set()]);
    expect(improvements([old], workout([set({ weight: "60" })]))).toHaveLength(
      2,
    );
    expect(improvements([old], workout([]))).toEqual([]);
    expect(
      prs([workout([set({ reps: "20" })], "reps")]).map((p) => p.metric),
    ).toEqual(["reps"]);
    expect(
      prs([workout([set({ seconds: "45" })], "duration")]).map((p) => p.metric),
    ).toEqual(["seconds"]);
  });
});
