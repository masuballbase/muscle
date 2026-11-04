import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, it, expect, vi } from "vitest";
import { openUserStore, type UserStore } from "../local-store";
import { TrainingController } from "./controller";
import type { TrainingRepository } from "./repository";
import { newWorkout } from "./model";
const controllers: TrainingController[] = [];
afterEach(() => {
  controllers.forEach((c) => c.dispose());
  controllers.length = 0;
});
async function setup(store?: UserStore) {
  const db = store ?? (await openUserStore("a", new IDBFactory()));
  const repo = {
    exercises: vi.fn().mockResolvedValue([]),
    menus:vi.fn().mockResolvedValue([]),
    workouts: vi.fn().mockResolvedValue([]),
    sync: vi.fn().mockResolvedValue(undefined),
    saveExercise: vi.fn(),
    used: vi.fn().mockResolvedValue(false),
    archive: vi.fn(),
  };
  const c = new TrainingController(db, repo as unknown as TrainingRepository);
  controllers.push(c);
  await c.initialize();
  return { c, repo, db };
}
describe("persistence and synchronization", () => {
  it("starts only once, saves before sync and restores without opening fullscreen", async () => {
    const { c, db } = await setup();
    await Promise.all([c.start(), c.start()]);
    await c.flushLocal();
    expect(c.state.workouts).toHaveLength(1);
    const id = c.active!.id;
    const restored = await setup(db);
    expect(restored.c.active?.id).toBe(id);
    expect(restored.c.state.fullScreen).toBe(false);
  });
  it("retains the same IDs/revision after failure and acknowledges retry", async () => {
    const { c, repo, db } = await setup();
    await c.start();
    repo.sync.mockRejectedValueOnce(new Error("offline"));
    await c.sync();
    expect(c.state.saveState).toBe("端末保存済み・未同期");
    const id = c.active!.id;
    expect(await db.get("session_drafts", id)).toBeDefined();
    await c.sync();
    expect(repo.sync.mock.calls.map((call) => call[0].id)).toEqual([id, id]);
    expect(c.state.saveState).toBe("同期済み");
    expect(await db.pendingCount()).toBe(0);
  });
  it("does not lose a newer edit while an older snapshot is in flight", async () => {
    const { c, repo, db } = await setup();
    await c.start();
    let resolve!: () => void;
    repo.sync.mockImplementationOnce(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        }),
    );
    const sync = c.sync();
    await vi.waitFor(() => expect(repo.sync).toHaveBeenCalledOnce());
    c.edit((w) => ({ ...w, name: "newer" }));
    resolve();
    await sync;
    await c.flushLocal();
    expect(repo.sync).toHaveBeenCalledTimes(2);
    expect(c.active!.name).toBe("newer");
    expect(
      (
        await db.get<{
          name: string;
          revision: number;
          syncedRevision: number;
        }>("session_drafts", c.active!.id)
      )?.value,
    ).toMatchObject({ name: "newer", revision: 2, syncedRevision: 2 });
  });
  it("shows local failure, keeps input in memory and does not send unsaved content", async () => {
    const { c, repo, db } = await setup();
    const put = vi.spyOn(db, "put").mockRejectedValue(new Error("quota"));
    await c.start();
    await c.sync();
    expect(c.active).toBeDefined();
    expect(c.state.saveState).toBe("端末保存失敗");
    expect(repo.sync).not.toHaveBeenCalled();
    put.mockRestore();
    await c.retry();
    expect(repo.sync).toHaveBeenCalledOnce();
  });
  it("retains offline completion across reopening, then syncs it before the next active session", async () => {
    const { c, repo, db } = await setup();
    await c.start();
    const id = c.active!.id;
    const ended = c.complete()!;
    await c.flushLocal();
    repo.sync.mockRejectedValue(new Error("offline"));
    await c.sync();
    expect(c.active).toBeUndefined();
    const reopened = await setup(db);
    expect(reopened.c.state.workouts.find((w) => w.id === id)?.endedAt).toBe(
      ended.endedAt,
    );
    await reopened.c.start();
    await reopened.c.sync();
    expect(reopened.repo.sync.mock.calls[0][0].id).toBe(id);
    expect(reopened.repo.sync.mock.calls[0][0].endedAt).toBe(ended.endedAt);
  });
  it("isolates accounts even with the same document id", async () => {
    const factory = new IDBFactory();
    const a = await openUserStore("a", factory);
    const b = await openUserStore("b", factory);
    await a.put("session_drafts", "private", newWorkout());
    const { c } = await setup(b);
    expect(c.state.workouts).toHaveLength(0);
    a.close();
    b.close();
  });
  it("prevents type changes and archive while locally in use", async () => {
    const { c, repo } = await setup();
    const exercise = {
      id: "exercise",
      name: "test",
      record_type: "weight_reps" as const,
      archived_at: null,
    };
    repo.exercises.mockResolvedValue([exercise]);
    await c.initialize();
    await c.start();
    c.edit((w) => ({
      ...w,
      sections: [
        {
          id: "section",
          exerciseId: "exercise",
          name: "test",
          type: "weight_reps",
          sets: [],
        },
      ],
    }));
    await expect(
      c.saveExercise({ ...exercise, record_type: "reps" }, false),
    ).rejects.toThrow("使用済み");
    await expect(c.removeExercise(exercise)).rejects.toThrow("進行中");
    expect(repo.archive).not.toHaveBeenCalled();
  });
});

it("notifies on subsequent first-session records and edits only after commit", async () => {
  const { c } = await setup();
  await c.start();
  c.edit((w) => ({
    ...w,
    sections: [
      {
        id: "s",
        exerciseId: "e",
        name: "test",
        type: "reps",
        sets: [
          {
            id: "first",
            weight: "",
            reps: "5",
            seconds: "",
            performed: false,
            copied: false,
          },
        ],
      },
    ],
  }));
  c.edit(
    (w) => ({
      ...w,
      sections: w.sections.map((s) => ({
        ...s,
        sets: s.sets.map((set) => ({ ...set, performed: true })),
      })),
    }),
    true,
  );
  expect(c.state.toast).toHaveLength(0);
  c.edit((w) => ({
    ...w,
    sections: w.sections.map((s) => ({
      ...s,
      sets: [
        ...s.sets,
        {
          id: "second",
          weight: "",
          reps: "6",
          seconds: "",
          performed: false,
          copied: false,
        },
      ],
    })),
  }));
  c.edit(
    (w) => ({
      ...w,
      sections: w.sections.map((s) => ({
        ...s,
        sets: s.sets.map((set) => ({ ...set, performed: true })),
      })),
    }),
    true,
  );
  expect(c.state.toast.map((p) => p.value)).toEqual([6]);
  c.edit(
    (w) => ({
      ...w,
      sections: w.sections.map((s) => ({
        ...s,
        sets: s.sets.map((set) =>
          set.id === "second" ? { ...set, reps: "8" } : set,
        ),
      })),
    }),
    false,
    true,
  );
  expect(c.state.toast.map((p) => p.value)).toEqual([6]);
  c.edit((w) => w, true);
  expect(c.state.toast.map((p) => p.value)).toEqual([8]);
});
it("recomputes first-record baselines after deleting the original performed set", async () => {
  const { c } = await setup();
  await c.start();
  c.edit(
    (w) => ({
      ...w,
      sections: [
        {
          id: "s",
          exerciseId: "e",
          name: "test",
          type: "reps",
          sets: [
            {
              id: "first",
              weight: "",
              reps: "5",
              seconds: "",
              performed: true,
              copied: false,
            },
          ],
        },
      ],
    }),
    true,
  );
  c.edit(
    (w) => ({
      ...w,
      sections: w.sections.map((s) => ({
        ...s,
        sets: [
          ...s.sets,
          {
            id: "second",
            weight: "",
            reps: "8",
            seconds: "",
            performed: true,
            copied: false,
          },
        ],
      })),
    }),
    true,
  );
  expect(c.state.toast).toHaveLength(1);
  c.edit((w) => ({
    ...w,
    sections: w.sections.map((s) => ({
      ...s,
      sets: s.sets.filter((set) => set.id !== "first"),
    })),
  }));
  expect(c.state.toast).toHaveLength(0);
  expect(c.active!.initialRecords?.[0].value).toBe(8);
});
