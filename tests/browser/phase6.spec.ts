// Local PostgreSQL + real Chromium: no real user data or real Supabase writes.
import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { readFileSync } from "node:fs";
import { db, prepare, USER, id } from "./helpers/local-backend";
import { verifiedFields } from "../fixtures/inbody-verified";
const now = new Date("2026-11-04T12:00:00Z");
test.use({ timezoneId: "Asia/Tokyo", viewport: { width: 390, height: 844 } });
async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("メールアドレス").fill("local@example.invalid");
  await page.getByLabel("パスワード").fill("local-only");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "自由に開始", exact: true }),
  ).toBeEnabled();
}
test.beforeEach(async ({ context }) => {
  await prepare(context, now);
});
test.afterEach(async ({ context }) => {
  await context.close();
  await db.close();
});
async function controls(context: BrowserContext) {
  const state = { offline: false, loseResponse: false, lost: false };
  await context.route(
    "https://mcuiikilwrxuylwuljmk.supabase.co/rest/v1/**",
    async (route) => {
      if (state.offline) {
        await route.abort("internetdisconnected");
        return;
      }
      if (
        state.loseResponse &&
        route.request().url().includes("/rpc/sync_training_session")
      ) {
        const body = route.request().postDataJSON();
        if (body.p_workout.endedAt) {
          state.loseResponse = false;
          state.lost = true;
          await db.transaction(async (tx) => {
            await tx.exec("SET LOCAL ROLE authenticated");
            await tx.query(
              "SELECT set_config('request.jwt.claim.sub',$1,true)",
              [USER],
            );
            await tx.query(
              "SELECT public.sync_training_session($1::jsonb,$2::jsonb)",
              [JSON.stringify(body.p_workout), JSON.stringify(body.p_expected)],
            );
          });
          await route.abort("failed");
          return;
        }
      }
      await route.fallback();
    },
  );
  return state;
}
async function startAndInput(page: Page) {
  await page.getByRole("button", { name: "自由に開始", exact: true }).click();
  await page.getByRole("button", { name: "種目を追加", exact: true }).click();
  await page
    .getByRole("dialog", { name: "種目を追加", exact: true })
    .getByRole("button", { name: /^テスト種目A / })
    .click();
  await page
    .getByLabel("テスト種目A セット1 重量（kg）", { exact: true })
    .fill("60");
  await page.getByLabel("テスト種目A セット1 回数", { exact: true }).fill("6");
  await page
    .getByRole("heading", { name: "トレーニング", exact: true })
    .click();
}
async function finish(page: Page) {
  await page
    .getByRole("button", { name: "トレーニングを終了", exact: true })
    .click();
  await page.getByRole("button", { name: "終了を確定", exact: true }).click();
}
async function output(page: Page) {
  await page
    .getByRole("button", { name: "JSONエクスポート", exact: true })
    .click();
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "JSONファイルを出力", exact: true })
    .click();
  const file = await download;
  const path = await file.path();
  if (!path) throw new Error("Download missing");
  return JSON.parse(readFileSync(path, "utf8"));
}
test("AT-026/027: offline input/end/reload, no formal analysis before ack, lost completion response then exact idempotent replay", async ({
  page,
  context,
}) => {
  const network = await controls(context);
  await login(page);
  network.offline = true;
  await startAndInput(page);
  await finish(page);
  await expect(page.locator(".save-status")).toContainText("未同期");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "記録", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "分析", exact: true })
    .click();
  await expect(page.getByTestId("session-count")).toHaveText("1件"); // only pre-existing fixture
  network.offline = false;
  network.loseResponse = true;
  await page.getByRole("button", { name: "保存を再試行", exact: true }).click();
  await expect.poll(() => network.lost).toBe(true);
  await expect(page.locator(".save-status")).toContainText("未同期");
  const before = (
    await db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM sessions WHERE name<>'日付またぎの記録' AND name<>'0セットの記録' AND status='completed'",
    )
  ).rows[0].n;
  expect(before).toBe(1);
  await page.getByRole("button", { name: "保存を再試行", exact: true }).click();
  await expect(page.locator(".save-status")).toContainText("同期済み");
  await expect(page.getByTestId("session-count")).toHaveText("2件");
  expect((await db.query("SELECT * FROM workout_sets")).rows).toHaveLength(2);
});
test("JSON includes all eight sources, pending same-ID versions and menu drafts; offline cache never claims to be fresh", async ({
  page,
  context,
}) => {
  const network = await controls(context);
  await login(page);
  const fresh = await output(page);
  expect(fresh.server.confirmation).toBe("fresh");
  expect(Object.keys(fresh.server.tables)).toHaveLength(8);
  await page.getByRole("button", { name: "JSONエクスポートを閉じる" }).click();
  await page.evaluate(
    async ({ user, session }) => {
      const request = indexedDB.open(`muscle:user:${user}`, 2);
      const store = await new Promise<IDBDatabase>((resolve) => {
        request.onsuccess = () => resolve(request.result);
      });
      const tx = store.transaction(
        ["session_drafts", "menu_drafts"],
        "readwrite",
      );
      tx.objectStore("session_drafts").put({
        id: session,
        value: {
          id: session,
          name: "unsynced version",
          startedAt: "2026-11-03T14:50:00Z",
          endedAt: "2026-11-03T15:30:00Z",
          revision: 2,
          syncedRevision: 1,
          sections: [],
          password: "DO_NOT_EXPORT",
        },
        updatedAt: "2026-11-04T12:00:00Z",
      });
      tx.objectStore("menu_drafts").put({
        id: "draft",
        value: {
          version: 1,
          id: "draft",
          name: "pending menu",
          items: [],
          base: null,
          access_token: "DO_NOT_EXPORT",
        },
        updatedAt: "2026-11-04T12:00:00Z",
      });
      await new Promise<void>((resolve) => {
        tx.oncomplete = () => resolve();
      });
      store.close();
    },
    { user: USER, session: id(30) },
  );
  network.offline = true;
  await page.reload();
  await expect(
    page.getByRole("button", { name: "JSONエクスポート", exact: true }),
  ).toBeVisible();
  const offline = await output(page);
  expect(offline.server.confirmation).toBe("cached");
  expect(
    offline.server.tables.sessions.find((s: { id: string }) => s.id === id(30))
      .revision,
  ).toBe(1);
  expect(offline.device.sessions[0].value.revision).toBe(2);
  expect(offline.device.menuDrafts[0].value.name).toBe("pending menu");
  expect(JSON.stringify(offline)).not.toContain("DO_NOT_EXPORT");
});
test("AT-028/029: disk failure keeps unsaved input, logout is stopped, keyboard geometry and light/dark preserve usable controls", async ({
  page,
  context,
}) => {
  await controls(context);
  await login(page);
  await startAndInput(page);
  await expect(page.locator(".save-status")).toContainText("同期済み");
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (
      ...args: Parameters<IDBObjectStore["put"]>
    ) {
      if (this.name === "session_drafts")
        throw new DOMException("quota", "QuotaExceededError");
      return original.apply(this, args);
    };
  });
  await page.getByLabel("テスト種目A セット1 回数", { exact: true }).fill("7");
  await expect(page.locator(".save-status")).toContainText("端末保存失敗");
  await page.goBack();
  await page.getByRole("button", { name: "ログアウト", exact: true }).click();
  await expect(
    page.getByText(
      "端末保存に失敗しています。ログアウト前に保存を再試行してください。",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "ログアウト", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "トレーニングを再開", exact: true })
    .click();
  await page.getByLabel("テスト種目A セット1 回数", { exact: true }).focus();
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport!, "height", {
      configurable: true,
      get: () => 400,
    });
    window.visualViewport!.dispatchEvent(new Event("resize"));
  });
  await expect(page.locator("html")).toHaveAttribute(
    "data-keyboard-open",
    "true",
  );
  expect(
    await page
      .getByRole("button", { name: "トレーニングを終了", exact: true })
      .evaluate((el) => el.getBoundingClientRect().height),
  ).toBeGreaterThanOrEqual(44);
  for (const theme of ["dark", "light"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.getByLabel("テスト種目A セット1 回数", { exact: true }).blur();
});
test("JSON preserves all 44 InBody fields including missing values and zero and rejects cross-user server rows", async ({
  page,
}) => {
  await db.query("INSERT INTO inbody_records VALUES($1,$2,$3,$4,$5,$6)", [
    id(650),
    USER,
    "2026-11-04",
    now.toISOString(),
    "dummy.csv",
    JSON.stringify(verifiedFields()),
  ]);
  await login(page);
  const file = await output(page);
  expect(
    Object.keys(file.server.tables.inbody_records[0].raw_fields),
  ).toHaveLength(44);
  expect(file.server.tables.inbody_records[0].raw_fields["上半身均衡"]).toBe(
    "0",
  );
  expect(
    file.server.tables.inbody_records[0].raw_fields["右腕体脂肪量(kg)"],
  ).toBeNull();
});

test("one writer per browser/user: a second tab waits and resumes with the latest saved workout after handoff", async ({
  page,
  context,
}) => {
  await login(page);
  await startAndInput(page);
  await expect(page.locator(".save-status")).toContainText("同期済み");
  const second = await context.newPage();
  await second.goto("/");
  await expect(
    second.getByText(
      "別タブが利用中の場合、このタブは保存しません。元のタブを閉じると利用できます。",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    second.getByRole("button", { name: "自由に開始", exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("テスト種目A セット1 回数", { exact: true }).fill("7");
  await page
    .getByRole("heading", { name: "トレーニング", exact: true })
    .click();
  await expect(page.locator(".save-status")).toContainText("同期済み");
  await page.close();
  await expect(
    second.getByRole("button", { name: "トレーニングを再開", exact: true }),
  ).toBeVisible();
  await second
    .getByRole("button", { name: "トレーニングを再開", exact: true })
    .click();
  await expect(
    second.getByLabel("テスト種目A セット1 回数", { exact: true }),
  ).toHaveValue("7");
});
