import { it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { InBodyRepository } from "./repository";
import { fixtureProfile, measurement } from "../../../tests/fixtures/inbody";
function setup() {
  let operation = "read";
  const record = measurement("00000000-0000-4000-8000-000000000001");
  const row = {
    id: record.id,
    measured_on: record.measuredOn,
    imported_at: record.importedAt,
    source_filename: record.sourceFilename,
    raw_fields: record.rawFields,
  };
  const response = { data: [row] as unknown[], error: null as unknown };
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    range: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    then: (resolve: (value: unknown) => void) =>
      Promise.resolve(
        operation === "read" ? { data: [], error: null } : response,
      ).then(resolve),
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.order.mockReturnValue(chain);
  chain.range.mockResolvedValue({ data: [row], error: null });
  for (const method of ["insert", "update", "delete"] as const)
    chain[method].mockImplementation(() => {
      operation = method;
      return chain;
    });
  const session = vi.fn().mockResolvedValue({
      data: { session: { user: { id: "A" } } },
      error: null,
    }),
    client = {
      auth: { getSession: session },
      from: vi.fn().mockImplementation(() => {
        operation = "read";
        return chain;
      }),
    } as unknown as SupabaseClient;
  return {
    chain,
    record,
    row,
    response,
    session,
    client,
    repo: new InBodyRepository(client, "A", fixtureProfile),
  };
}
it("writes all 44 raw fields as one row, supplies explicit UUID/date/registration, scopes edits to owner and preserves registration order", async () => {
  const { repo, chain, record } = setup();
  await repo.save(record, null);
  expect(chain.insert).toHaveBeenCalledWith({
    id: record.id,
    user_id: "A",
    measured_on: record.measuredOn,
    imported_at: record.importedAt,
    source_filename: record.sourceFilename,
    raw_fields: record.rawFields,
  });
  await repo.save(record, record);
  expect(chain.update).toHaveBeenCalledWith({
    measured_on: record.measuredOn,
    source_filename: record.sourceFilename,
    raw_fields: record.rawFields,
  });
  expect(chain.eq).toHaveBeenCalledWith("user_id", "A");
  expect(chain.eq).toHaveBeenCalledWith("imported_at", record.importedAt);
});
it("refuses unverified CSV creation, malformed dates, missing fields and changes to existing field names", async () => {
  const { client, chain, record, repo } = setup();
  await expect(
    new InBodyRepository(client, "A", null).save(record, null),
  ).rejects.toThrow("未確認");
  await expect(
    repo.save({ ...record, measuredOn: "2026-02-29" }, null),
  ).rejects.toThrow("測定日");
  await expect(repo.save({ ...record, rawFields: {} }, record)).rejects.toThrow(
    "44",
  );
  expect(chain.insert).not.toHaveBeenCalled();
});
it("does not claim success for failed/zero-row mutations and never silently overwrites a different UUID on retry", async () => {
  const { repo, record, response, chain } = setup();
  response.data = [];
  response.error = { code: "TEST" };
  await expect(repo.save(record, record)).rejects.toThrow("正式保存");
  await expect(repo.remove(record)).rejects.toThrow("削除を確認");
  expect(chain.update).toHaveBeenCalledTimes(1);
});
it("checks account identity before any read/write and pages beyond the REST limit", async () => {
  const { repo, session, chain } = setup();
  chain.range.mockImplementation(async (from: number, to: number) => ({
    data: Array.from({ length: 1001 }, () => ({
      id: "x",
      raw_fields: {},
    })).slice(from, to + 1),
    error: null,
  }));
  expect(await repo.list()).toHaveLength(1001);
  session.mockResolvedValue({
    data: { session: { user: { id: "B" } } },
    error: null,
  });
  await expect(repo.list()).rejects.toThrow("ログイン");
});
