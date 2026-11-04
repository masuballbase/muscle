// @vitest-environment jsdom
// Synthetic profile injection is confined to this unit test, never production.
import { it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { previewCsv } from "@/lib/inbody/csv";
import {
  fixtureProfile,
  fields,
  csv,
  measurement,
} from "../../tests/fixtures/inbody";
import type { Measurement } from "@/lib/inbody/model";
import { InBodyImport } from "./inbody-import";
const state = vi.hoisted(() => ({
  records: [] as Measurement[],
  fresh: vi.fn(),
  importRow: vi.fn(),
}));
vi.mock("./inbody-context", () => ({
  useInBody: () => ({ records: state.records, controller: state }),
}));
vi.mock("./exercise-manager", () => ({
  Sheet: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("./dialog-history", () => ({
  useDialogHistory: () => ({ close: vi.fn() }),
}));
vi.mock("@/lib/inbody/profile", async () => ({
  verifiedCsvProfile: (await import("../../tests/fixtures/inbody"))
    .fixtureProfile,
}));
afterEach(() => {
  cleanup();
  state.records.length = 0;
  vi.resetAllMocks();
});
it("preserves failed preview rows, confirms per-row success, and retries only unsaved rows", async () => {
  const preview = previewCsv(
    csv([fields("70"), fields("71")]),
    "InBody-20261104.csv",
    fixtureProfile,
  );
  for (const row of preview.rows) row.action = "add";
  state.fresh.mockImplementation(async () => state.records);
  state.importRow
    .mockImplementationOnce(async (record: Measurement) => {
      state.records.push(record);
      return "saved";
    })
    .mockRejectedValueOnce(new Error("Injected save failure"))
    .mockImplementation(async (record: Measurement) => {
      state.records.push(record);
      return "saved";
    });
  render(
    <InBodyImport
      filename="InBody-20261104.csv"
      preview={preview}
      onClose={() => {}}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "確認した行を正式保存" }));
  await screen.findByText("Injected save failure");
  expect(state.importRow).toHaveBeenCalledTimes(2);
  expect(state.records).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "確認した行を正式保存" }));
  await waitFor(() => expect(screen.getByText(/正式保存 2件/)).toBeDefined());
  expect(state.importRow).toHaveBeenCalledTimes(3);
  expect(state.importRow.mock.calls[2][0].id).toBe(preview.rows[1].id);
});
it("skips complete duplicates without a write and forces explicit same-day decisions/target selection", async () => {
  state.records.push(measurement());
  state.fresh.mockImplementation(async () => state.records);
  const preview = previewCsv(
    csv([fields(), fields("71")]),
    "InBody-20261104.csv",
    fixtureProfile,
  );
  render(
    <InBodyImport
      filename="InBody-20261104.csv"
      preview={preview}
      onClose={() => {}}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "確認した行を正式保存" }));
  await screen.findByText("同日異値：追加・置換・スキップを選択してください。");
  expect(state.importRow).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("同日異値の処理（3行）"), {
    target: { value: "replace" },
  });
  fireEvent.click(screen.getByRole("button", { name: "確認した行を正式保存" }));
  await screen.findByText("置換する測定を指定してください。");
  state.importRow.mockResolvedValue("saved");
  fireEvent.change(screen.getByLabelText("置換する測定（3行）"), {
    target: { value: "one" },
  });
  fireEvent.click(screen.getByRole("button", { name: "確認した行を正式保存" }));
  await waitFor(() => expect(state.importRow).toHaveBeenCalledOnce());
  expect(state.importRow.mock.calls[0][1]).toBe("one");
});
