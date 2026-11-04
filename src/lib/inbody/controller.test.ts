import { it, expect, vi, afterEach } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { openUserStore } from "../local-store";
import { InBodyController } from "./controller";
import type { InBodyRepository } from "./repository";
import { measurement, fields } from "../../../tests/fixtures/inbody";
const controllers: InBodyController[] = [];
afterEach(() => controllers.splice(0).forEach((c) => c.dispose()));
async function setup() {
  const store = await openUserStore("A", new IDBFactory());
  const repo = {
    list: vi.fn().mockResolvedValue([measurement()]),
    save: vi.fn(),
    remove: vi.fn(),
  };
  const controller = new InBodyController(
    store,
    repo as unknown as InBodyRepository,
  );
  controllers.push(controller);
  await controller.initialize();
  return { controller, store, repo };
}
it("keeps formal state/cache unchanged after failed edits and deletions, retains all raw fields", async () => {
  const { controller, repo, store } = await setup();
  const before = structuredClone(controller.snapshot().records);
  repo.save.mockRejectedValue(new Error("offline"));
  repo.remove.mockRejectedValue(new Error("offline"));
  await expect(
    controller.save({ ...before[0], rawFields: fields("80") }, before[0]),
  ).rejects.toThrow();
  await expect(controller.remove(before[0])).rejects.toThrow();
  expect(controller.snapshot().records).toEqual(before);
  expect((await store.get("cache", "inbody"))?.value).toEqual(before);
});
it("replaces the formal row only after success and removes deleted latest rows", async () => {
  const { controller, repo } = await setup();
  const changed = { ...measurement(), rawFields: fields("80") };
  repo.save.mockResolvedValue(changed);
  await controller.save(changed, measurement());
  expect(controller.snapshot().records[0].rawFields).toEqual(fields("80"));
  repo.remove.mockResolvedValue(undefined);
  await controller.remove(changed);
  expect(controller.snapshot().records).toEqual([]);
});
it("reconciles duplicates without writing and requires replacement to target the same date", async () => {
  const { controller, repo } = await setup();
  expect(await controller.importRow(measurement())).toBe("duplicate");
  expect(repo.save).not.toHaveBeenCalled();
  await expect(
    controller.importRow(
      { ...measurement("two", "2026-11-03"), rawFields: fields("80") },
      "one",
    ),
  ).rejects.toThrow("同じ日");
});
it("restores cached records offline, without reading or writing training data", async () => {
  const { controller, store, repo } = await setup();
  const training = { marker: "untouched" };
  await store.put("cache", "training", training);
  repo.list.mockRejectedValue(new Error("offline"));
  controller.dispose();
  const restored = new InBodyController(
    store,
    repo as unknown as InBodyRepository,
  );
  controllers.push(restored);
  await restored.initialize();
  expect(restored.snapshot()).toMatchObject({ ready: true, online: false });
  expect(restored.snapshot().records).toHaveLength(1);
  expect((await store.get("cache", "training"))?.value).toEqual(training);
});
it("distinguishes a successful server save from failed device cache persistence", async () => {
  const { controller, store, repo } = await setup();
  repo.save.mockResolvedValue(measurement());
  vi.spyOn(store, "put").mockRejectedValue(new Error("disk full"));
  await controller.save(measurement(), measurement());
  expect(controller.snapshot()).toMatchObject({ online: true });
  expect(controller.snapshot().message).toContain("端末保存に失敗");
});
