// Synthetic load only: no real user data, network or Supabase writes.
import { it, expect } from "vitest";
import {
  overallAnalysis,
  exerciseAnalysis,
} from "../../src/lib/analytics/model";
import type { Workout } from "../../src/lib/training/model";
it("projects 10,000 synthetic sessions / 30,000 sets without truncating IDs or counts", () => {
  const now = new Date("2026-11-04T12:00:00Z");
  const workloads: Workout[] = Array.from({ length: 10000 }, (_, i) => ({
    id: `load-${i}`,
    name: "synthetic",
    startedAt: new Date(now.getTime() - i * 3600000).toISOString(),
    endedAt: now.toISOString(),
    revision: 1,
    syncedRevision: 1,
    sections: [
      {
        id: `section-${i}`,
        exerciseId: "load-exercise",
        name: "synthetic exercise",
        type: "weight_reps",
        sets: Array.from({ length: 3 }, (_, j) => ({
          id: `set-${i}-${j}`,
          weight: "50",
          reps: String(j + 5),
          seconds: "",
          performed: true,
          copied: false,
        })),
      },
    ],
  }));
  const start = performance.now();
  const overall = overallAnalysis(workloads, [], "all", now, "Asia/Tokyo");
  const graph = exerciseAnalysis(
    workloads,
    "load-exercise",
    "all",
    "oneRM",
    null,
    now,
    "Asia/Tokyo",
  );
  const elapsed = performance.now() - start;
  expect(overall.sessions).toBe(10000);
  expect(overall.ranking[0].count).toBe(10000);
  expect(graph.points).toHaveLength(10000);
  console.info(
    JSON.stringify({
      benchmark: "synthetic-analysis",
      sessions: 10000,
      sets: 30000,
      elapsedMs: Math.round(elapsed),
    }),
  );
}, 30000);
