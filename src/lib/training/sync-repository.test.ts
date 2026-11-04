import { it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TrainingRepository } from "./repository";
import { newWorkout, SyncConflictError, syncSnapshot } from "./model";
function setup() {
  const response = {
    data: 1 as number | null,
    error: null as { code: string } | null,
  };
  const builder = { retry: () => builder, abortSignal: async () => response };
  const rpc = vi.fn().mockReturnValue(builder);
  const from = vi.fn();
  const client = {
    auth: {
      getSession: async () => ({
        data: { session: { user: { id: "A" } } },
        error: null,
      }),
    },
    rpc,
    from,
  } as unknown as SupabaseClient;
  return { rpc, from, response, repo: new TrainingRepository(client, "A") };
}
it("uses only the atomic RPC, sends exact expected versions and checks acknowledged revision", async () => {
  const { repo, rpc, from, response } = setup(),
    w = newWorkout();
  await repo.sync(w);
  expect(from).not.toHaveBeenCalled();
  expect(rpc).toHaveBeenCalledWith("sync_training_session", {
    p_workout: syncSnapshot(w),
    p_expected: [null],
  });
  response.data = 0;
  await expect(repo.sync(w)).rejects.toThrow("版を確認");
});
it("keeps missing-RPC/conflict distinct and permits legacy reconciliation only without authorizing absent rows", async () => {
  const { repo, rpc, response } = setup(),
    w = newWorkout();
  response.data = null;
  response.error = { code: "PGRST202" };
  await expect(repo.sync(w)).rejects.toThrow("未完了");
  response.error = { code: "PT409" };
  await expect(repo.sync(w)).rejects.toBeInstanceOf(SyncConflictError);
  rpc.mockClear();
  await expect(
    repo.sync({ ...w, revision: 2, syncedRevision: 1 }),
  ).rejects.toBeInstanceOf(SyncConflictError);
  expect(rpc.mock.calls[0][1].p_expected).toEqual([]);
  response.error = null;
  response.data = 2;
  await repo.sync({ ...w, revision: 2, syncedRevision: 1 });
});
