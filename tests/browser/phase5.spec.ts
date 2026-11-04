// Chromium with local PGlite only: fixture data is generated, never personal.
import { test, expect, type Page } from "@playwright/test";
import {
  db,
  prepare,
  id,
  USER,
  setInBodyFailure,
} from "./helpers/local-backend";
import { verifiedFields, verifiedCsv } from "../fixtures/inbody-verified";
const now = new Date("2026-11-04T12:00:00Z");
test.use({ timezoneId: "Asia/Tokyo", viewport: { width: 390, height: 844 } });
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
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "InBody", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "最新4指標", exact: true }),
  ).toBeVisible();
}
async function upload(page: Page, weights: string[]) {
  await page.getByLabel("CSV取り込み").setInputFiles({
    name: "InBody-20261104(1).csv",
    mimeType: "text/csv",
    buffer: Buffer.from(verifiedCsv(weights.map(verifiedFields))),
  });
  await expect(
    page.getByRole("dialog", { name: "CSV取り込みプレビュー" }),
  ).toBeVisible();
}
async function closePreview(page: Page) {
  const dialog = page.getByRole("dialog", { name: "CSV取り込みプレビュー" });
  await dialog
    .getByRole("button", { name: "CSV取り込みプレビューを閉じる" })
    .click();
  await expect(dialog).toHaveCount(0);
}
test("AT-021–024: BOM/suffix preview, raw null/zero, exact duplicates, same-day add and all graph/period/region switches", async ({
  page,
}) => {
  await login(page);
  await upload(page, ["70"]);
  await expect(page.getByLabel("測定日（2行）")).toHaveValue("2026-11-04");
  expect((await db.query("SELECT * FROM inbody_records")).rows).toHaveLength(0);
  await page.getByRole("button", { name: "確認した行を正式保存" }).click();
  await expect(page.getByText(/正式保存 1件/)).toBeVisible();
  await closePreview(page);
  const top = page.getByRole("region", { name: "最新4指標" });
  await expect(top).toContainText("70");
  await expect(top).toContainText("45");
  const raw = (
    await db.query<{ raw_fields: Record<string, unknown> }>(
      "SELECT raw_fields FROM inbody_records",
    )
  ).rows[0].raw_fields;
  expect(Object.keys(raw)).toHaveLength(44);
  expect(raw["上半身均衡"]).toBe("0");
  expect(raw["右腕体脂肪量(kg)"]).toBeNull();
  expect(raw["日付"]).toBe("2.0261E+13");
  await page.clock.setFixedTime(new Date(now.getTime() + 1000));
  await upload(page, ["70", "71"]);
  await page.getByLabel("同日異値の処理（3行）").selectOption("add");
  await page.getByRole("button", { name: "確認した行を正式保存" }).click();
  await expect(page.getByText(/正式保存 1件 ／ スキップ 1件/)).toBeVisible();
  await closePreview(page);
  expect((await db.query("SELECT id FROM inbody_records")).rows).toHaveLength(
    2,
  );
  await expect(top).toContainText("71");
  await page
    .getByLabel("同日の測定", { exact: true })
    .selectOption({ index: 1 });
  await expect(top).toContainText("70");
  const titles = await page.locator("main h2").allTextContents();
  expect(titles.indexOf("最新4指標")).toBeLessThan(
    titles.indexOf("成長グラフ"),
  );
  expect(titles.indexOf("成長グラフ")).toBeLessThan(titles.indexOf("測定履歴"));
  for (const graph of [
    "weight",
    "skeletalMuscleMass",
    "bodyFatPercent",
    "fatMass",
    "score",
  ]) {
    await page.getByLabel("グラフの種類", { exact: true }).selectOption(graph);
    await expect(page.locator("svg circle")).toHaveCount(2);
  }
  await page
    .getByLabel("グラフの種類", { exact: true })
    .selectOption("regional");
  for (const region of ["arms", "legs", "trunk"]) {
    await page.getByLabel("部位", { exact: true }).selectOption(region);
    await expect(page.locator("svg circle")).toHaveCount(
      region === "trunk" ? 2 : 4,
    );
  }
  await page.getByLabel("グラフの種類", { exact: true }).selectOption("weight");
  for (const period of ["quarter", "half", "year", "all", "month"]) {
    await page.getByLabel("集計期間", { exact: true }).selectOption(period);
    await expect(page.locator("svg circle")).toHaveCount(2);
  }
  await page
    .getByRole("button", { name: "2026-11-04 体重 71", exact: true })
    .click();
  await expect(page.getByText("2026-11-04・体重：71kg")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("same-day explicit replacement and skip, date correction, numeric row errors and server failure retain preview", async ({
  page,
}) => {
  await login(page);
  await upload(page, ["70"]);
  setInBodyFailure(true);
  await page.getByRole("button", { name: "確認した行を正式保存" }).click();
  await expect(page.getByText(/失敗 1件/)).toBeVisible();
  expect((await db.query("SELECT id FROM inbody_records")).rows).toHaveLength(
    0,
  );
  setInBodyFailure(false);
  await page.getByRole("button", { name: "確認した行を正式保存" }).click();
  await expect(page.getByText(/正式保存 1件/)).toBeVisible();
  await closePreview(page);
  await upload(page, ["80", "90"]);
  await page.getByLabel("同日異値の処理（2行）").selectOption("replace");
  const target = (
    await db.query<{ id: string }>("SELECT id FROM inbody_records")
  ).rows[0].id;
  await page.getByLabel("置換する測定（2行）").selectOption(target);
  await page.getByLabel("同日異値の処理（3行）").selectOption("skip");
  await page.getByRole("button", { name: "確認した行を正式保存" }).click();
  await expect(page.getByText(/正式保存 1件 ／ スキップ 1件/)).toBeVisible();
  await closePreview(page);
  expect((await db.query("SELECT id FROM inbody_records")).rows).toHaveLength(
    1,
  );
  await expect(page.getByRole("region", { name: "最新4指標" })).toContainText(
    "80",
  );
  const bad = verifiedFields("bad");
  await page.getByLabel("CSV取り込み").setInputFiles({
    name: "InBody-20261104(1).csv",
    mimeType: "text/csv",
    buffer: Buffer.from(verifiedCsv([bad])),
  });
  const dialog = page.getByRole("dialog", { name: "CSV取り込みプレビュー" });
  await expect(dialog.getByRole("alert")).toContainText("体重(kg)");
  await dialog.getByText("全44項目を確認・修正").click();
  await page.getByLabel("2行 体重(kg)", { exact: true }).fill("75");
  await page.getByLabel("測定日（2行）").fill("2026-11-03");
  await page.getByRole("button", { name: "確認した行を正式保存" }).click();
  await expect(page.getByText(/正式保存 1件/)).toBeVisible();
  await closePreview(page);
  expect((await db.query("SELECT id FROM inbody_records")).rows).toHaveLength(
    2,
  );
});
test("AT-025: 44-field detail, dirty cancellation, atomic failed/successful edits, deletion fallback, training/PR/goals unaffected", async ({
  page,
}) => {
  for (const [n, weight, imported] of [
    [600, "70", "2026-11-04T01:00:00Z"],
    [601, "71", "2026-11-04T02:00:00Z"],
  ] as const)
    await db.query("INSERT INTO inbody_records VALUES($1,$2,$3,$4,$5,$6)", [
      id(n),
      USER,
      "2026-11-04",
      imported,
      "dummy.csv",
      JSON.stringify(verifiedFields(weight)),
    ]);
  const before = (
    await db.query(
      "SELECT jsonb_build_object('sessions',(SELECT jsonb_agg(s) FROM sessions s),'sets',(SELECT jsonb_agg(w) FROM workout_sets w),'goals',(SELECT jsonb_agg(g) FROM weekly_goal_schedule g)) AS value",
    )
  ).rows[0];
  await login(page);
  await page.getByRole("button", { name: "表示中の測定詳細" }).click();
  await expect(page.getByRole("dialog").locator("dt")).toHaveCount(44);
  await page.getByRole("button", { name: "編集", exact: true }).click();
  await page.getByLabel("体重(kg)", { exact: true }).fill("90");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "キャンセル", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "編集", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "編集", exact: true }).click();
  await page.getByLabel("体重(kg)", { exact: true }).fill("80");
  setInBodyFailure(true);
  await page.getByRole("button", { name: "測定を正式保存" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "正式保存",
  );
  setInBodyFailure(false);
  await page.getByRole("button", { name: "測定を正式保存" }).click();
  await expect(
    page.getByRole("button", { name: "編集", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "測定詳細を閉じる" }).click();
  await expect(page.getByRole("region", { name: "最新4指標" })).toContainText(
    "80",
  );
  await expect(page.locator("svg circle")).toHaveCount(2);
  await page.getByRole("button", { name: "表示中の測定詳細" }).click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "この測定を削除" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "最新4指標" })).toContainText(
    "70",
  );
  await expect(page.locator("svg circle")).toHaveCount(1);
  await page.reload();
  await expect(page.getByRole("region", { name: "最新4指標" })).toContainText(
    "70",
  );
  const after = (
    await db.query(
      "SELECT jsonb_build_object('sessions',(SELECT jsonb_agg(s) FROM sessions s),'sets',(SELECT jsonb_agg(w) FROM workout_sets w),'goals',(SELECT jsonb_agg(g) FROM weekly_goal_schedule g)) AS value",
    )
  ).rows[0];
  expect(after).toEqual(before);
});
