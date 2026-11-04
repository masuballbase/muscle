// Real Chromium + local PostgreSQL/RLS. No live Supabase writes.
import { test, expect } from "@playwright/test";
import {
  db,
  prepare,
  id,
  USER,
  EA,
  HISTORY,
  SECTION,
  SET,
  startDay,
  zeroDay,
  setRpcFailure,
} from "./helpers/local-backend";
test.use({ timezoneId: "Asia/Tokyo", viewport: { width: 390, height: 844 } });
test.beforeEach(async ({ context }) => {
  await prepare(context);
});
test.afterEach(async ({ context }) => {
  await context.close();
  await db.close();
});
async function login(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByLabel("メールアドレス").fill("local-test@example.invalid");
  await page.getByLabel("パスワード").fill("local-test");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "自由に開始", exact: true }),
  ).toBeEnabled();
}
async function pickExercise(
  page: import("@playwright/test").Page,
  name: string,
) {
  const dialog = page.getByRole("dialog", { name: "種目を追加", exact: true });
  await dialog
    .getByRole("button", { name: new RegExp(`^${name} `) })
    .first()
    .click();
}
async function selectMenu(page: import("@playwright/test").Page) {
  await page
    .locator("article.menu-card")
    .first()
    .getByRole("button")
    .first()
    .click();
  await page
    .getByRole("button", { name: "このメニューを確定", exact: true })
    .click();
}
test("menu draft restoration, failed formal save, explicit selection and idempotent application", async ({
  page,
}) => {
  test.setTimeout(90000);
  await login(page);
  await page.getByRole("button", { name: "メニュー管理", exact: true }).click();
  await page.getByRole("button", { name: "新規作成", exact: true }).click();
  await page.getByRole("button", { name: "ゼロから作成", exact: true }).click();
  await page.getByLabel("メニュー名", { exact: true }).fill("定番メニュー");
  await page
    .getByRole("button", { name: "メニューに種目を追加", exact: true })
    .click();
  await pickExercise(page, "テスト種目A");
  await page.getByLabel("テスト種目Aの予定セット数").fill("5");
  await page
    .getByRole("button", { name: "メニューに種目を追加", exact: true })
    .click();
  await pickExercise(page, "テスト種目B");
  await page.getByLabel("テスト種目Bの予定セット数").fill("2");
  await page
    .locator(".menu-items li")
    .first()
    .dragTo(page.locator(".menu-items li").last());
  await expect(page.locator(".menu-items li").first()).toContainText(
    "テスト種目B",
  );
  await page
    .getByRole("button", { name: "正式メニューを保存", exact: true })
    .click();
  await expect(page.getByText("正式保存済み", { exact: true })).toBeVisible();
  await page
    .locator("article.menu-card")
    .first()
    .getByRole("button")
    .first()
    .click();
  await page.getByLabel("メニュー名", { exact: true }).fill("未保存編集");
  await expect(
    page.getByText("端末下書き保存済み", { exact: true }),
  ).toBeVisible();
  setRpcFailure(true);
  await page
    .getByRole("button", { name: "正式メニューを保存", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "正式保存を確認できません",
  );
  expect(
    (await db.query<{ name: string }>("SELECT name FROM menus")).rows[0].name,
  ).toBe("定番メニュー");
  await page
    .getByRole("button", { name: "下書きを残して閉じる", exact: true })
    .click();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "自由に開始", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "メニュー管理", exact: true }).click();
  await page
    .locator("article.menu-card")
    .first()
    .getByRole("button")
    .first()
    .click();
  await page.getByRole("button", { name: "下書きを再開", exact: true }).click();
  await expect(page.getByLabel("メニュー名", { exact: true })).toHaveValue(
    "未保存編集",
  );
  setRpcFailure(false);
  await page
    .getByRole("button", { name: "正式メニューを保存", exact: true })
    .click();
  await expect(page.getByText("正式保存済み", { exact: true })).toBeVisible();
  await page
    .locator("article.menu-card")
    .first()
    .getByRole("button")
    .first()
    .click();
  await page.getByLabel("メニュー名", { exact: true }).fill("破棄する下書き");
  await expect(
    page.getByText("端末下書き保存済み", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "下書きを残して閉じる", exact: true })
    .click();
  await page.getByRole("button", { name: "メニュー管理", exact: true }).click();
  await page
    .locator("article.menu-card")
    .first()
    .getByRole("button")
    .first()
    .click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "下書きを破棄", exact: true }).click();
  await expect(page.getByLabel("メニュー名", { exact: true })).toHaveValue(
    "未保存編集",
  );
  await expect(
    page.getByText("正式メニューと同じ内容", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "下書きを残して閉じる", exact: true })
    .click();
  await page.getByRole("button", { name: "メニュー管理", exact: true }).click();
  await page
    .locator("article.menu-card")
    .first()
    .getByRole("button")
    .first()
    .click();
  await expect(
    page.getByRole("button", { name: "下書きを再開", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("正式メニューと同じ内容", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "下書きを残して閉じる", exact: true })
    .click();
  await page
    .getByRole("button", { name: "メニューから開始", exact: true })
    .click();
  await page
    .locator("article.menu-card")
    .first()
    .getByRole("button")
    .first()
    .click();
  expect(
    (await db.query("SELECT id FROM sessions WHERE status='active'")).rows,
  ).toHaveLength(0);
  await page
    .getByRole("button", { name: "メニューを選択を閉じる", exact: true })
    .click();
  expect(
    (await db.query("SELECT id FROM sessions WHERE status='active'")).rows,
  ).toHaveLength(0);
  await page
    .getByRole("button", { name: "メニューから開始", exact: true })
    .click();
  await selectMenu(page);
  await expect(page.locator(".workout-section")).toHaveCount(2);
  await expect(page.locator(".set-row")).toHaveCount(2); // only first accordion is open
  const before = (await db.query("SELECT * FROM menu_items ORDER BY position"))
    .rows;
  await page
    .getByRole("button", { name: "メニューを適用", exact: true })
    .click();
  await selectMenu(page);
  await expect(page.locator(".workout-section")).toHaveCount(2);
  expect(
    (await db.query("SELECT * FROM menu_items ORDER BY position")).rows,
  ).toEqual(before);
  await page.getByLabel("テスト種目B セット1 回数", { exact: true }).fill("12");
  await page
    .getByRole("heading", { name: "トレーニング", exact: true })
    .click();
  await page
    .getByRole("button", { name: "トレーニングを終了", exact: true })
    .click();
  await expect(page.getByText(/未実施セットが6件/)).toBeVisible();
  await page.getByRole("button", { name: "終了を確定", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "トレーニング完了", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".save-status")).toContainText("同期済み");
});
test("calendar, snapshot detail, cancellation, atomic edit failure, successful edit and cascading delete", async ({
  page,
}) => {
  test.setTimeout(90000);
  await login(page);
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "履歴", exact: true })
    .click();
  await expect(
    page
      .getByRole("button", { name: `${startDay}の記録`, exact: true })
      .getByLabel("実施記録あり", { exact: true }),
  ).toHaveCount(1);
  await expect(
    page
      .getByRole("button", { name: `${zeroDay}の記録`, exact: true })
      .locator(".calendar-dot"),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: `${zeroDay}の記録`, exact: true })
    .click();
  await expect(
    page
      .getByRole("region", { name: "選択日の記録", exact: true })
      .getByRole("button", { name: /0セットの記録/ }),
  ).toBeVisible();
  const recent = page.getByRole("region", { name: "直近の記録", exact: true });
  await recent.getByRole("button", { name: /日付またぎの記録/ }).click();
  await expect(
    page.getByRole("heading", { name: "当時の種目名", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "編集", exact: true }).click();
  await page.getByLabel("セッション名", { exact: true }).fill("破棄する変更");
  page.once("dialog", (dialog) => dialog.accept());
  await page.goBack();
  expect(
    (
      await db.query<{ name: string }>(
        "SELECT name FROM sessions WHERE id=$1",
        [HISTORY],
      )
    ).rows[0].name,
  ).toBe("日付またぎの記録");
  await recent.getByRole("button", { name: /日付またぎの記録/ }).click();
  await page.getByRole("button", { name: "編集", exact: true }).click();
  await page.getByLabel("セッション名", { exact: true }).fill("保存した履歴");
  await page
    .getByLabel("当時の種目名 履歴セット1 重量（kg）", { exact: true })
    .fill("80");
  setRpcFailure(true);
  await page
    .getByRole("button", { name: "履歴を正式保存", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "正式保存を確認できません",
  );
  expect(
    (
      await db.query<{ weight_kg: string }>(
        "SELECT weight_kg FROM workout_sets WHERE id=$1",
        [SET],
      )
    ).rows[0].weight_kg,
  ).toBe("50");
  setRpcFailure(false);
  await page
    .getByRole("button", { name: "履歴を正式保存", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "保存した履歴", exact: true }),
  ).toBeVisible();
  expect(
    (
      await db.query<{ exercise_name_snapshot: string }>(
        "SELECT exercise_name_snapshot FROM session_exercises WHERE id=$1",
        [SECTION],
      )
    ).rows[0].exercise_name_snapshot,
  ).toBe("当時の種目名");
  expect(
    (
      await db.query<{ weight_kg: string }>(
        "SELECT weight_kg FROM workout_sets WHERE id=$1",
        [SET],
      )
    ).rows[0].weight_kg,
  ).toBe("80");
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "この履歴を削除", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    recent.getByRole("button", { name: /保存した履歴/ }),
  ).toHaveCount(0);
  await expect(
    page
      .getByRole("button", { name: `${startDay}の記録`, exact: true })
      .locator(".calendar-dot"),
  ).toHaveCount(0);
  expect((await db.query("SELECT * FROM workout_sets")).rows).toHaveLength(0);
  expect((await db.query("SELECT * FROM session_exercises")).rows).toHaveLength(
    0,
  );
});

test("HTTP 409 conflicts preserve formal data and show explicit reload guidance", async ({
  page,
}) => {
  const menu = id(50),
    item = id(51);
  await db.query("INSERT INTO menus VALUES($1,$2,$3)", [
    menu,
    USER,
    "競合するメニュー",
  ]);
  await db.query("INSERT INTO menu_items VALUES($1,$2,$3,$4,0,2)", [
    item,
    USER,
    menu,
    EA,
  ]);
  await login(page);
  await page.getByRole("button", { name: "メニュー管理", exact: true }).click();
  await page
    .locator("article.menu-card")
    .filter({ hasText: "競合するメニュー" })
    .getByRole("button")
    .first()
    .click();
  await page.getByLabel("メニュー名", { exact: true }).fill("古いメニュー編集");
  await expect(
    page.getByText("端末下書き保存済み", { exact: true }),
  ).toBeVisible();
  await db.query("UPDATE menus SET name=$1 WHERE id=$2", [
    "別の正式更新",
    menu,
  ]);
  await page
    .getByRole("button", { name: "正式メニューを保存", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "メニューが更新されています",
  );
  expect(
    (
      await db.query<{ name: string }>("SELECT name FROM menus WHERE id=$1", [
        menu,
      ])
    ).rows[0].name,
  ).toBe("別の正式更新");
  await page
    .getByRole("button", { name: "下書きを残して閉じる", exact: true })
    .click();
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "履歴", exact: true })
    .click();
  await page
    .getByRole("region", { name: "直近の記録", exact: true })
    .getByRole("button", { name: /日付またぎの記録/ })
    .click();
  await page.getByRole("button", { name: "編集", exact: true }).click();
  await page.getByLabel("セッション名", { exact: true }).fill("古い履歴編集");
  await db.query("UPDATE sessions SET name=$1,revision=2 WHERE id=$2", [
    "別の正式履歴更新",
    HISTORY,
  ]);
  await page
    .getByRole("button", { name: "履歴を正式保存", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "履歴が更新されています",
  );
  expect(
    (
      await db.query<{ name: string; revision: number }>(
        "SELECT name,revision FROM sessions WHERE id=$1",
        [HISTORY],
      )
    ).rows[0],
  ).toEqual({ name: "別の正式履歴更新", revision: 2 });
});
