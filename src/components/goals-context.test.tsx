// @vitest-environment jsdom
import { it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  waitFor,
  fireEvent,
  cleanup,
} from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { openUserStore } from "@/lib/local-store";
import { GoalsProvider, useGoals } from "./goals-context";
const mocks = vi.hoisted(() => ({ list: vi.fn(), save: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ getSupabase: () => ({}) }));
vi.mock("@/lib/analytics/goals-repository", () => ({
  GoalsRepository: class {
    list = mocks.list;
    save = mocks.save;
  },
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
function Probe() {
  const state = useGoals();
  return (
    <>
      <output aria-label="goal-state">
        {JSON.stringify({
          goals: state.goals,
          loaded: state.loaded,
          online: state.online,
          message: state.message,
        })}
      </output>
      <button
        onClick={() => void state.save(4, "Asia/Tokyo").catch(() => undefined)}
      >
        save
      </button>
    </>
  );
}
const saved = { id: "goal", effective_monday: "2026-11-09", target_days: 4 };
it("restores the account's cached schedule on failed network read without claiming server confirmation", async () => {
  const factory = new IDBFactory(),
    a = await openUserStore("A", factory),
    b = await openUserStore("B", factory);
  await a.put("cache", "weekly-goals", [saved]);
  mocks.list.mockRejectedValue(new Error("offline"));
  const view = render(
    <GoalsProvider userId="A" store={a}>
      <Probe />
    </GoalsProvider>,
  );
  await waitFor(() =>
    expect(screen.getByLabelText("goal-state").textContent).toContain(
      '"target_days":4',
    ),
  );
  await waitFor(() =>
    expect(screen.getByLabelText("goal-state").textContent).toContain(
      "読み込めません",
    ),
  );
  expect(screen.getByLabelText("goal-state").textContent).toContain(
    '"online":false',
  );
  view.unmount();
  render(
    <GoalsProvider userId="B" store={b}>
      <Probe />
    </GoalsProvider>,
  );
  await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
  expect(screen.getByLabelText("goal-state").textContent).not.toContain(
    '"target_days":4',
  );
  a.close();
  b.close();
});
it("does not let a focus reload race overwrite a confirmed save", async () => {
  const store = await openUserStore("A", new IDBFactory());
  mocks.list.mockResolvedValueOnce([]).mockResolvedValue([saved]);
  let resolve!: (value: typeof saved) => void;
  mocks.save.mockImplementation(
    () =>
      new Promise<typeof saved>((r) => {
        resolve = r;
      }),
  );
  render(
    <GoalsProvider userId="A" store={store}>
      <Probe />
    </GoalsProvider>,
  );
  await waitFor(() =>
    expect(screen.getByLabelText("goal-state").textContent).toContain(
      '"online":true',
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "save" }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
  fireEvent(window, new Event("focus"));
  expect(mocks.list).toHaveBeenCalledTimes(1);
  resolve(saved);
  await waitFor(() =>
    expect(screen.getByLabelText("goal-state").textContent).toContain(
      '"target_days":4',
    ),
  );
  await waitFor(async () =>
    expect((await store.get("cache", "weekly-goals"))?.value).toEqual([saved]),
  );
  expect(mocks.list).toHaveBeenCalledTimes(2);
  store.close();
});
