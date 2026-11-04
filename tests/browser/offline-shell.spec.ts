// Full transport offline: localhost app shell AND Supabase are unavailable after caching.
import { test, expect } from "@playwright/test";
import { prepare, db } from "./helpers/local-backend";
test.use({
  serviceWorkers: "allow",
  timezoneId: "Asia/Tokyo",
  viewport: { width: 390, height: 844 },
});
test("public-only service worker supports genuine offline reload, local completion and reconnection without duplicate sessions", async ({
  page,
  context,
}) => {
  test.setTimeout(90000);
  await prepare(context);
  let offline = false;
  await context.route(
    "https://mcuiikilwrxuylwuljmk.supabase.co/**",
    async (route) => {
      if (offline) await route.abort("internetdisconnected");
      else await route.fallback();
    },
  );
  try {
    await page.goto("/");
    await page.getByLabel("メールアドレス").fill("local@example.invalid");
    await page.getByLabel("パスワード").fill("local-only");
    await page.getByRole("button", { name: "ログイン", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "自由に開始", exact: true }),
    ).toBeEnabled();
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller)
        await new Promise<void>((resolve) =>
          navigator.serviceWorker.addEventListener(
            "controllerchange",
            () => resolve(),
            { once: true },
          ),
        );
    });
    const paths = await page.evaluate(async () => {
      const keys = await caches.keys(),
        cache = await caches.open(
          keys.find((k) => k.startsWith("muscle-shell-"))!,
        );
      return (await cache.keys()).map((r) => new URL(r.url).pathname);
    });
    expect(paths).toContain("/");
    expect(paths).toContain("/analysis");
    expect(
      paths.every(
        (p) =>
          ["/", "/history", "/analysis", "/inbody"].includes(p) ||
          p.startsWith("/_next/static/"),
      ),
    ).toBe(true);
    offline = true;
    await context.setOffline(true);
    await page.reload();
    await expect(
      page.getByRole("button", { name: "自由に開始", exact: true }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "自由に開始", exact: true }).click();
    await page.getByRole("button", { name: "種目を追加", exact: true }).click();
    await page
      .getByRole("dialog", { name: "種目を追加", exact: true })
      .getByRole("button", { name: /^テスト種目A / })
      .click();
    await page
      .getByLabel("テスト種目A セット1 重量（kg）", { exact: true })
      .fill("60");
    await page
      .getByLabel("テスト種目A セット1 回数", { exact: true })
      .fill("6");
    await page
      .getByRole("heading", { name: "トレーニング", exact: true })
      .click();
    await page
      .getByRole("button", { name: "トレーニングを終了", exact: true })
      .click();
    await page.getByRole("button", { name: "終了を確定", exact: true }).click();
    await expect(page.locator(".save-status")).toContainText("未同期");
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "記録", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "完了サマリー" }),
    ).toContainText("未同期");
    offline = false;
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(page.locator(".save-status")).toContainText("同期済み");
    expect(
      (
        await db.query(
          "SELECT id FROM sessions WHERE name NOT IN ('日付またぎの記録','0セットの記録')",
        )
      ).rows,
    ).toHaveLength(1);
    expect((await db.query("SELECT id FROM workout_sets")).rows).toHaveLength(
      2,
    );
  } finally {
    await context.close();
    await db.close();
  }
});
