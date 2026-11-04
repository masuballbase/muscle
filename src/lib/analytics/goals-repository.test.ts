import { it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { GoalsRepository } from "./goals-repository";
function setup() {
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    range: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    maybeSingle: vi.fn(),
  };
  for (const key of ["eq", "order", "select", "insert", "update"] as const)
    chain[key].mockReturnValue(chain);
  chain.maybeSingle.mockResolvedValue({ data: null, error: null });
  const session = vi
    .fn()
    .mockResolvedValue({
      data: { session: { user: { id: "owner" } } },
      error: null,
    });
  const client = {
    auth: { getSession: session },
    from: vi.fn().mockReturnValue(chain),
  } as unknown as SupabaseClient;
  const confirm = (
    data: unknown = [
      { id: "goal", effective_monday: "2026-11-09", target_days: 4 },
    ],
    error: unknown = null,
  ) =>
    chain.select.mockImplementation((columns: string) =>
      columns === "id" ? chain : Promise.resolve({ data, error }),
    );
  return {
    chain,
    session,
    confirm,
    repo: new GoalsRepository(client, "owner"),
  };
}
it("pages the entire historical schedule, scopes reads to owner", async () => {
  const { repo, chain } = setup();
  chain.range.mockImplementation(async (from: number, to: number) => ({
    data: Array.from({ length: 1001 }, (_, i) => ({ id: String(i) })).slice(
      from,
      to + 1,
    ),
    error: null,
  }));
  expect(await repo.list()).toHaveLength(1001);
  expect(chain.eq).toHaveBeenCalledWith("user_id", "owner");
});
it("generates an explicit UUID for a new goal, only for next Monday", async () => {
  const { repo, chain, confirm } = setup();
  confirm();
  await repo.save(4, "Asia/Tokyo", new Date("2026-11-04T01:00:00Z"));
  expect(chain.insert).toHaveBeenCalledWith({
    id: expect.stringMatching(/^[0-9a-f-]{36}$/),
    user_id: "owner",
    effective_monday: "2026-11-09",
    target_days: 4,
  });
  expect(chain.update).not.toHaveBeenCalled();
});
it("preserves existing UUID and changes only next week's target", async () => {
  const { repo, chain, confirm } = setup();
  confirm();
  chain.maybeSingle.mockResolvedValue({
    data: { id: "existing-goal" },
    error: null,
  });
  await repo.save(2, "Asia/Tokyo", new Date("2026-11-04T01:00:00Z"));
  expect(chain.update).toHaveBeenCalledWith({ target_days: 2 });
  expect(chain.eq).toHaveBeenCalledWith("id", "existing-goal");
  expect(chain.eq).toHaveBeenCalledWith("effective_monday", "2026-11-09");
  expect(chain.insert).not.toHaveBeenCalled();
});
it("rejects failed/zero-row writes and does not retry a racing insert over another UUID", async () => {
  const { repo, chain, confirm } = setup();
  confirm(null, { code: "23505" });
  await expect(repo.save(3, "Asia/Tokyo")).rejects.toThrow(
    "正式保存を確認できません",
  );
  confirm([]);
  await expect(repo.save(3, "Asia/Tokyo")).rejects.toThrow(
    "正式保存を確認できません",
  );
  expect(chain.insert).toHaveBeenCalledTimes(2);
  expect(chain.update).not.toHaveBeenCalled();
});
it("refuses writes after failed lookup or account switch, validates goal days", async () => {
  const { repo, chain, session } = setup();
  for (const n of [0, 8, 1.5])
    await expect(repo.save(n, "Asia/Tokyo")).rejects.toThrow("1〜7日");
  chain.maybeSingle.mockResolvedValue({ data: null, error: { code: "TEST" } });
  await expect(repo.save(3, "Asia/Tokyo")).rejects.toThrow(
    "目標を確認できません",
  );
  session.mockResolvedValue({
    data: { session: { user: { id: "other" } } },
    error: null,
  });
  await expect(repo.list()).rejects.toThrow("ログイン状態");
  expect(chain.insert).not.toHaveBeenCalled();
  expect(chain.update).not.toHaveBeenCalled();
});
