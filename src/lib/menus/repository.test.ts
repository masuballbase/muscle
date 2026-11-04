import { it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TrainingRepository } from "../training/repository";
import { availableMenu } from "./model";
it("does not remove valid saved-menu exercises beyond the REST row limit", async () => {
  const rows = Array.from({ length: 1001 }, (_, index) => ({
    id: String(index),
    name: `exercise ${index}`,
    record_type: "reps",
    archived_at: null,
  }));
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    range: vi.fn(async (from: number, to: number) => ({
      data: rows.slice(from, to + 1),
      error: null,
    })),
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.order.mockReturnValue(chain);
  const client = {
    auth: {
      getSession: async () => ({
        data: { session: { user: { id: "owner" } } },
        error: null,
      }),
    },
    from: () => chain,
  } as unknown as SupabaseClient;
  const exercises = await new TrainingRepository(client, "owner").exercises();
  expect(exercises).toHaveLength(1001);
  expect(
    availableMenu(
      {
        id: "m",
        name: "preserved",
        items: [{ id: "item", exerciseId: "1000", plannedSets: 1 }],
      },
      exercises,
    ).needsFix,
  ).toBe(false);
});
