// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
  fireEvent,
} from "@testing-library/react";
import { AppShell } from "./app-shell";
const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  onAuthStateChange: vi.fn(),
  openUserStore: vi.fn(),
  close: vi.fn(),
  pendingCount: vi.fn(),
  unsubscribe: vi.fn(),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
vi.mock("@/lib/supabase", () => ({ getSupabase: () => ({ auth: mocks }) }));
vi.mock("@/lib/local-store", () => ({ openUserStore: mocks.openUserStore }));
const session = { user: { id: "account-a", email: "test@example.invalid" } };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.getSession.mockResolvedValue({ data: { session: null }, error: null });
  mocks.onAuthStateChange.mockReturnValue({
    data: { subscription: { unsubscribe: mocks.unsubscribe } },
  });
  mocks.openUserStore.mockResolvedValue({
    close: mocks.close,
    pendingCount: mocks.pendingCount,
  });
  mocks.pendingCount.mockResolvedValue(0);
  mocks.signOut.mockResolvedValue({ error: null });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
describe("authentication shell", () => {
  it("restores a session and exposes exactly four tabs with account storage", async () => {
    mocks.getSession.mockResolvedValue({ data: { session }, error: null });
    render(
      <AppShell>
        <h1>記録</h1>
      </AppShell>,
    );
    await screen.findByText("端末保存基盤：利用可能");
    expect(mocks.openUserStore).toHaveBeenCalledWith("account-a");
    const nav = screen.getByRole("navigation");
    expect(nav.querySelectorAll("a")).toHaveLength(4);
    expect(
      nav.querySelector('[aria-current="page"]')?.getAttribute("href"),
    ).toBe("/");
  });
  it("submits credentials without exposing an internal authentication error", async () => {
    mocks.signInWithPassword.mockResolvedValue({
      error: { message: "sensitive service response" },
    });
    render(<AppShell>private area</AppShell>);
    await screen.findByLabelText("メールアドレス");
    fireEvent.change(screen.getByLabelText("メールアドレス"), {
      target: { value: "test@example.invalid" },
    });
    fireEvent.change(screen.getByLabelText("パスワード"), {
      target: { value: "test-only-placeholder" },
    });
    fireEvent.click(screen.getByRole("button", { name: "ログイン" }));
    await screen.findByRole("alert");
    expect(mocks.signInWithPassword).toHaveBeenCalledOnce();
    expect(screen.queryByText("sensitive service response")).toBeNull();
    expect(screen.queryByText("private area")).toBeNull();
  });
  it("keeps pending local data when logout confirmation is cancelled", async () => {
    mocks.getSession.mockResolvedValue({ data: { session }, error: null });
    mocks.pendingCount.mockResolvedValue(1);
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<AppShell>private area</AppShell>);
    await screen.findByText("端末保存基盤：利用可能");
    fireEvent.click(screen.getByRole("button", { name: "ログアウト" }));
    await waitFor(() => expect(window.confirm).toHaveBeenCalledOnce());
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(screen.getByText("private area")).toBeDefined();
  });
  it("clears authenticated UI after logout, without deleting account data", async () => {
    mocks.getSession.mockResolvedValue({ data: { session }, error: null });
    render(<AppShell>private area</AppShell>);
    await screen.findByText("端末保存基盤：利用可能");
    fireEvent.click(screen.getByRole("button", { name: "ログアウト" }));
    await screen.findByRole("button", { name: "ログイン" });
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(mocks.close).toHaveBeenCalled();
    expect(screen.queryByText("private area")).toBeNull();
  });
  it("shows local storage failure without reporting sync success", async () => {
    mocks.getSession.mockResolvedValue({ data: { session }, error: null });
    mocks.openUserStore.mockRejectedValue(new Error("unavailable"));
    render(<AppShell>private area</AppShell>);
    await screen.findByText("端末保存失敗");
    expect(screen.queryByText("同期済み")).toBeNull();
    expect(screen.getByRole("alert")).toBeDefined();
  });
});
