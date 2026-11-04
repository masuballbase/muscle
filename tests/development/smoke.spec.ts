// Development mode smoke with local fake Auth/PostgreSQL only.
import { test, expect } from "@playwright/test";
import { prepare, db } from "../browser/helpers/local-backend";
test("development login, four tabs and account-only JSON export; no production worker registration", async ({
  page,
  context,
}) => {
  test.setTimeout(90000);
  await prepare(context);
  try {
    await page.goto("/");
    await page.getByLabel("メールアドレス").fill("local@example.invalid");
    await page.getByLabel("パスワード").fill("local-only");
    await page.getByRole("button", { name: "ログイン", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "自由に開始", exact: true }),
    ).toBeEnabled();
    for (const name of ["履歴", "分析", "InBody", "記録"]) {
      await page
        .getByRole("navigation")
        .getByRole("link", { name, exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name, exact: true }),
      ).toBeVisible();
    }
    await expect(page.getByText(/^オフライン用画面/)).toHaveCount(0);
    expect(
      await page.evaluate(async () =>
        "serviceWorker" in navigator
          ? (await navigator.serviceWorker.getRegistrations()).length
          : 0,
      ),
    ).toBe(0);
    await page
      .getByRole("button", { name: "JSONエクスポート", exact: true })
      .click();
    const download = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "JSONファイルを出力", exact: true })
      .click();
    await download;
    await expect(page.getByRole("region", { name: "出力結果" })).toContainText(
      "今回全件取得",
    );
  } finally {
    await context.close();
    await db.close();
  }
});
