// All Supabase traffic is intercepted into local PGlite; no production fixtures.
import { test, expect, type Page } from "@playwright/test";
import {
  db,
  prepare,
  id,
  USER,
  EA,
  HISTORY,
  setGoalsFailure,
} from "./helpers/local-backend";
import { nextMonday, monday } from "../../src/lib/analytics/model";
import { dayKey } from "../../src/lib/history/model";
const now = new Date("2026-11-04T03:00:00Z"),
  tz = "Asia/Tokyo";
test.use({ timezoneId: tz, viewport: { width: 390, height: 844 } });
test.beforeEach(async ({ context, page }) => {
  await prepare(context, now);
  await page.clock.setFixedTime(now);
});
test.afterEach(async ({ context }) => {
  await context.close();
  await db.close();
});
async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("メールアドレス").fill("local@example.invalid");
  await page.getByLabel("パスワード").fill("local-only");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "自由に開始", exact: true }),
  ).toBeEnabled();
}
async function analysis(page: Page) {
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "分析", exact: true })
    .click();
  const overview = page.getByRole("heading", {
    name: "5つの指標",
    exact: true,
  });
  const back = page.getByRole("button", {
    name: "全体分析へ戻る",
    exact: true,
  });
  await expect(overview.or(back)).toBeVisible();
  if (await back.isVisible()) await back.click();
  await expect(overview).toBeVisible();
}
async function extraSession(
  n: number,
  type = "weight_reps",
  weight: number | null = 70,
  reps: number | null = 5,
  seconds: number | null = null,
) {
  const exercise = type === "weight_reps" ? EA : id(n + 3);
  if (type !== "weight_reps")
    await db.query("INSERT INTO exercises VALUES($1,$2,$3,$4,null)", [
      exercise,
      USER,
      type === "reps" ? "回数の分析" : "時間の分析",
      type,
    ]);
  await db.query("INSERT INTO sessions VALUES($1,$2,$3,$4,$5,'completed',1)", [
    id(n),
    USER,
    `追加${n}`,
    "2026-11-03T10:00:00Z",
    "2026-11-03T11:00:00Z",
  ]);
  await db.query("INSERT INTO session_exercises VALUES($1,$2,$3,$4,$5,$6,0)", [
    id(n + 1),
    USER,
    id(n),
    exercise,
    type === "weight_reps"
      ? "当時の種目名"
      : type === "reps"
        ? "回数の分析"
        : "時間の分析",
    type,
  ]);
  await db.query(
    "INSERT INTO workout_sets VALUES($1,$2,$3,$4,0,$5,$6,$7,true,false)",
    [id(n + 2), USER, id(n + 1), type, weight, reps, seconds],
  );
}
test("overall order, same-day frequency, periods, archived ID, same-weight graph and unsynced exclusion", async ({
  page,
}) => {
  await extraSession(100);
  await db.query(
    "UPDATE exercises SET name='変更後の種目',archived_at=now() WHERE id=$1",
    [EA],
  );
  await login(page);
  // Inject only a dedicated device-only completed record, never a server write.
  await page.evaluate(
    async ({ user, start }) => {
      const request = indexedDB.open(`muscle:user:${user}`, 2);
      const local = await new Promise<IDBDatabase>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject();
      });
      const tx = local.transaction("session_drafts", "readwrite");
      tx.objectStore("session_drafts").put({
        id: "pending-only",
        value: {
          id: "pending-only",
          name: "未同期",
          startedAt: start,
          endedAt: start,
          revision: 2,
          syncedRevision: 0,
          sections: [
            {
              id: "section-pending",
              exerciseId: "pending-exercise",
              name: "未同期専用",
              type: "reps",
              sets: [
                {
                  id: "set-pending",
                  weight: "",
                  reps: "999",
                  seconds: "",
                  performed: true,
                  copied: false,
                },
              ],
            },
          ],
        },
        updatedAt: start,
      });
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject();
      });
      local.close();
    },
    { user: USER, start: "2026-11-03T01:00:00Z" },
  );
  // Block writes for device-only invalid fixture so it remains pending.
  await page.route("**/rest/v1/**", async (route) => {
    if (route.request().method() !== "GET") await route.abort();
    else await route.fallback();
  });
  await page.reload();
  await analysis(page);
  await expect(page.getByTestId("training-days")).toHaveText("1日");
  await expect(page.getByTestId("session-count")).toHaveText("2件");
  const titles = await page.locator("main h2").allTextContents();
  expect(titles.indexOf("5つの指標")).toBeLessThan(
    titles.indexOf("トレーニング頻度"),
  );
  expect(titles.indexOf("トレーニング頻度")).toBeLessThan(
    titles.indexOf("種目別実施頻度ランキング"),
  );
  await expect(
    page
      .getByRole("region", { name: "種目別実施頻度ランキング", exact: true })
      .getByRole("button"),
  ).toHaveText("変更後の種目（削除済み）：2件");
  for (const period of ["quarter", "half", "year", "all", "month"]) {
    await page.getByLabel("集計期間", { exact: true }).selectOption(period);
    await expect(page.getByTestId("session-count")).toHaveText("2件");
  }
  await page
    .getByRole("searchbox", { name: "種目名で検索", exact: true })
    .fill("当時の種目名");
  await page
    .getByRole("region", { name: "分析する種目を検索" })
    .getByRole("button")
    .click();
  await expect(page.getByRole("region", { name: "正式PR" })).toContainText(
    "70kg",
  );
  await expect(page.locator("svg circle")).toHaveCount(2);
  await page.getByLabel("グラフの指標").selectOption("sameWeightReps");
  await page.getByLabel("比較する重量").selectOption("50");
  await expect(page.locator("svg circle")).toHaveCount(1);
  await page.getByLabel("比較する重量").selectOption("70");
  await expect(page.locator("svg circle")).toHaveCount(1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("weekly goals preserve this week/history, last next-week edit wins, failed save stays unchanged and reload restores", async ({
  page,
}) => {
  const week = monday(dayKey(now, tz)),
    next = nextMonday(now, tz);
  await db.query(
    "INSERT INTO weekly_goal_schedule(id,user_id,effective_monday,target_days) VALUES($1,$2,$3,2)",
    [id(500), USER, week],
  );
  await login(page);
  await analysis(page);
  const goal = page.getByRole("region", { name: "週間目標", exact: true });
  await expect(goal).toContainText("1日 / 2日・達成率 50%");
  for (const target of ["3", "4"]) {
    await goal
      .getByRole("button", { name: "週間目標を変更", exact: true })
      .click();
    await goal.getByLabel("週間目標日数").selectOption(target);
    await goal
      .getByRole("button", { name: "来週の目標を保存", exact: true })
      .click();
    await expect(goal).toContainText(`${next}からの目標：${target}日`);
  }
  expect(
    (
      await db.query(
        "SELECT target_days FROM weekly_goal_schedule WHERE effective_monday=$1",
        [week],
      )
    ).rows[0],
  ).toMatchObject({ target_days: 2 });
  expect(
    (await db.query("SELECT * FROM weekly_goal_schedule")).rows,
  ).toHaveLength(2);
  await goal
    .getByRole("button", { name: "週間目標を変更", exact: true })
    .click();
  await goal.getByLabel("週間目標日数").selectOption("6");
  setGoalsFailure(true);
  await goal
    .getByRole("button", { name: "来週の目標を保存", exact: true })
    .click();
  await expect(goal.getByRole("alert")).toContainText(
    "正式保存を確認できません",
  );
  await expect(goal).toContainText(`${next}からの目標：4日`);
  setGoalsFailure(false);
  await page.reload();
  await expect(goal).toContainText(`${next}からの目標：4日`);
  await expect(goal).toContainText("1日 / 2日・達成率 50%");
  await page.getByLabel("集計期間", { exact: true }).selectOption("all");
  await expect(goal).toContainText("1日 / 2日・達成率 50%");
});
test("history edits/deletes immediately recalculate formal PR and graph; zero and one point states", async ({
  page,
}) => {
  await login(page);
  await analysis(page);
  const rank = page.getByRole("region", {
    name: "種目別実施頻度ランキング",
    exact: true,
  });
  await rank.getByRole("button").click();
  await expect(page.locator("svg circle")).toHaveCount(1);
  await expect(page.getByRole("region", { name: "正式PR" })).toContainText(
    "50kg",
  );
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "履歴", exact: true })
    .click();
  await page
    .getByRole("region", { name: "直近の記録", exact: true })
    .getByRole("button", { name: /日付またぎの記録/ })
    .click();
  await page.getByRole("button", { name: "編集", exact: true }).click();
  await page
    .getByLabel("当時の種目名 履歴セット1 重量（kg）", { exact: true })
    .fill("80");
  await page
    .getByRole("button", { name: "履歴を正式保存", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "編集", exact: true }),
  ).toBeVisible();
  await page.goBack();
  await analysis(page);
  await rank.getByRole("button").click();
  await expect(page.getByRole("region", { name: "正式PR" })).toContainText(
    "80kg",
  );
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "履歴", exact: true })
    .click();
  await page
    .getByRole("region", { name: "直近の記録", exact: true })
    .getByRole("button", { name: /日付またぎの記録/ })
    .click();
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "この履歴を削除", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await analysis(page);
  await expect(page.getByTestId("session-count")).toHaveText("0件");
  await page
    .getByRole("searchbox", { name: "種目名で検索", exact: true })
    .fill("テスト種目A");
  await page
    .getByRole("region", { name: "分析する種目を検索" })
    .getByRole("button")
    .click();
  await expect(page.locator("svg circle")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "正式PR" })).toContainText(
    "PRはまだありません",
  );
  expect(
    (await db.query("SELECT id FROM sessions WHERE id=$1", [HISTORY])).rows,
  ).toHaveLength(0);
});
test("reps and duration metric switches keep one point and show type-specific PRs", async ({
  page,
}) => {
  await extraSession(200, "reps", null, 8);
  await extraSession(300, "duration", null, null, 45);
  await login(page);
  await analysis(page);
  for (const [name, metrics, pr] of [
    ["回数の分析", ["reps", "totalReps"], "8回"],
    ["時間の分析", ["seconds", "totalSeconds"], "45秒"],
  ] as const) {
    await page
      .getByRole("region", { name: "分析する種目を検索" })
      .getByRole("button", { name, exact: true })
      .click();
    await expect(page.getByRole("region", { name: "正式PR" })).toContainText(
      pr,
    );
    for (const metric of metrics) {
      await page.getByLabel("グラフの指標").selectOption(metric);
      await expect(page.locator("svg circle")).toHaveCount(1);
    }
    await page
      .getByRole("button", { name: "全体分析へ戻る", exact: true })
      .click();
  }
});
