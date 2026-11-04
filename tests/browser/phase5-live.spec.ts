// Real Supabase + Chromium, guarded UUID fixtures only. No uploaded personal data.
import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { loginClients } from "../../scripts/lib/test-clients.mjs";
import { InBodyFixtures } from "../../scripts/lib/inbody-fixtures.mjs";
import { Phase3Fixtures } from "../../scripts/lib/phase3-fixtures.mjs";
import { verifiedCsv, verifiedFields } from "../fixtures/inbody-verified";
import { InBodyRepository } from "../../src/lib/inbody/repository";
import { TrainingRepository } from "../../src/lib/training/repository";
import { GoalsRepository } from "../../src/lib/analytics/goals-repository";
import { prs } from "../../src/lib/training/model";
const fixtures = new InBodyFixtures(),
  training = new Phase3Fixtures("/tmp/muscle-phase5-training-fixtures.json");
async function login(page: Page, label: string) {
  await page.goto("/");
  await page.getByRole("button", { name: "ログイン", exact: true }).waitFor();
  await page.evaluate(
    ({ email, password }) => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      for (const [id, value] of [
        ["email", email],
        ["password", password],
      ]) {
        const input = document.getElementById(id) as HTMLInputElement;
        setter.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    },
    {
      email: process.env[`MUSCLE_TEST_${label}_EMAIL`]!,
      password: process.env[`MUSCLE_TEST_${label}_PASSWORD`]!,
    },
  );
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "自由に開始", exact: true }),
  ).toBeEnabled({ timeout: 20000 });
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "InBody", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "最新4指標", exact: true }),
  ).toBeVisible();
}
async function connect(
  context: BrowserContext,
  a: Awaited<ReturnType<typeof loginClients>>[number],
) {
  const network = { fail: false };
  await context.route(
    "https://mcuiikilwrxuylwuljmk.supabase.co/**",
    async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      try {
        if (
          url.pathname.startsWith("/rest/v1/") &&
          !["GET", "HEAD"].includes(request.method())
        ) {
          if (!url.pathname.endsWith("/inbody_records"))
            throw new Error("Unexpected table mutation");
          if (request.method() === "POST") {
            const body = JSON.parse(request.postData()!);
            if (
              Array.isArray(body) ||
              body.user_id !== a.userId ||
              Object.keys(body.raw_fields ?? {}).length !== 44
            )
              throw new Error("Unsafe measurement insertion");
            await fixtures.reserve(a, body.id);
          } else {
            const id = url.searchParams.get("id");
            if (
              !id?.startsWith("eq.") ||
              !fixtures.has(a.label, id.slice(3)) ||
              url.searchParams.get("user_id") !== `eq.${a.userId}`
            )
              throw new Error("Refusing existing measurement mutation");
          }
          if (network.fail) {
            await route.fulfill({
              status: 503,
              contentType: "application/json",
              body: JSON.stringify({
                code: "TEST_FAILURE",
                message: "Injected failure",
              }),
            });
            return;
          }
        }
        const headers = { ...request.headers() };
        delete headers.host;
        delete headers["content-length"];
        const response = await fetch(request.url(), {
          method: request.method(),
          headers,
          body: request.postData() ?? undefined,
        });
        const output = Object.fromEntries(response.headers.entries());
        delete output["content-length"];
        delete output["content-encoding"];
        await route.fulfill({
          status: response.status,
          headers: output,
          body: Buffer.from(await response.arrayBuffer()),
        });
      } catch {
        await route.abort("failed");
      }
    },
  );
  return network;
}
async function upload(page: Page, weight: string) {
  await page
    .getByLabel("CSV取り込み")
    .setInputFiles({
      name: "InBody-20261104(1).csv",
      mimeType: "text/csv",
      buffer: Buffer.from(verifiedCsv([verifiedFields(weight)])),
    });
  await expect(
    page.getByRole("dialog", { name: "CSV取り込みプレビュー" }),
  ).toBeVisible();
}
async function closePreview(page: Page) {
  await page
    .getByRole("button", { name: "CSV取り込みプレビューを閉じる" })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}
for (const label of ["A", "B"])
  test(`Phase 5 live ${label}: import, duplicate, same-day, edit/delete, owner isolation and unchanged training PR/goals`, async ({
    page,
    context,
  }) => {
    test.setTimeout(180000);
    const accounts = await loginClients(),
      a = accounts.find((a) => a.label === label)!,
      other = accounts.find((a) => a.label !== label)!;
    try {
      fixtures.requireEmpty();
      training.requireEmpty();
      const e = randomUUID(),
        session = randomUUID(),
        section = randomUUID(),
        set = randomUUID();
      for (const [table, row] of [
        [
          "exercises",
          { id: e, name: `phase5-${randomUUID()}`, record_type: "weight_reps" },
        ],
        [
          "sessions",
          {
            id: session,
            name: "Phase 5 dedicated regression fixture",
            started_at: new Date(Date.now() - 3600000).toISOString(),
            ended_at: new Date(Date.now() - 1800000).toISOString(),
            status: "completed",
            revision: 1,
          },
        ],
        [
          "session_exercises",
          {
            id: section,
            session_id: session,
            exercise_id: e,
            exercise_name_snapshot: "Phase 5 fixture",
            record_type_snapshot: "weight_reps",
            position: 0,
          },
        ],
        [
          "workout_sets",
          {
            id: set,
            session_exercise_id: section,
            record_type: "weight_reps",
            position: 0,
            weight_kg: 50,
            reps: 5,
            is_performed: true,
            is_copied: false,
          },
        ],
      ] as const) {
        await training.reserve(a, table, row.id);
        const r = await a.client
          .from(table)
          .insert({ ...row, user_id: a.userId });
        if (r.error) throw new Error("Training fixture insertion failed");
      }
      const trainRepo = new TrainingRepository(a.client, a.userId),
        goalRepo = new GoalsRepository(a.client, a.userId),
        bodyRepo = new InBodyRepository(a.client, a.userId),
        beforeWorkouts = await trainRepo.workouts(),
        beforePrs = prs(beforeWorkouts),
        beforeGoals = await goalRepo.list();
      const network = await connect(context, a);
      await login(page, label);
      await upload(page, "70");
      await page.getByRole("button", { name: "確認した行を正式保存" }).click();
      await expect(page.getByText(/正式保存 1件/)).toBeVisible({
        timeout: 15000,
      });
      await closePreview(page);
      await upload(page, "71");
      await page.getByLabel("同日異値の処理（2行）").selectOption("add");
      await page.getByRole("button", { name: "確認した行を正式保存" }).click();
      await expect(page.getByText(/正式保存 1件/)).toBeVisible({
        timeout: 15000,
      });
      await closePreview(page);
      await expect(page.locator("svg circle")).toHaveCount(2);
      const own = (await bodyRepo.list()).filter((r) =>
        fixtures.has(a.label, r.id),
      );
      expect(own).toHaveLength(2);
      expect(Object.keys(own[0].rawFields)).toHaveLength(44);
      expect(own[0].rawFields["上半身均衡"]).toBe("0");
      expect(own[0].rawFields["右腕体脂肪量(kg)"]).toBeNull();
      await upload(page, "70");
      await page.getByRole("button", { name: "確認した行を正式保存" }).click();
      await expect(page.getByText(/正式保存 0件 ／ スキップ 1件/)).toBeVisible({
        timeout: 15000,
      });
      await closePreview(page);
      for (const record of own) {
        const read = await other.client
          .from("inbody_records")
          .select("id")
          .eq("id", record.id);
        expect(read.error).toBeNull();
        expect(read.data).toHaveLength(0);
        for (const query of [
          other.client
            .from("inbody_records")
            .update({ raw_fields: {} })
            .eq("id", record.id)
            .select("id"),
          other.client
            .from("inbody_records")
            .delete()
            .eq("id", record.id)
            .select("id"),
        ]) {
          const r = await query;
          expect(r.error).toBeNull();
          expect(r.data).toHaveLength(0);
        }
      }
      const forged = randomUUID();
      await fixtures.reserve(a, forged);
      const rejected = await other.client
        .from("inbody_records")
        .insert({
          id: forged,
          user_id: a.userId,
          measured_on: "2026-11-04",
          imported_at: new Date().toISOString(),
          raw_fields: verifiedFields(),
        });
      expect(rejected.error?.code).toBe("42501");
      expect(
        (await bodyRepo.list()).filter((r) => fixtures.has(a.label, r.id)),
      ).toEqual(own);
      await page.getByRole("button", { name: "表示中の測定詳細" }).click();
      await expect(page.getByRole("dialog").locator("dt")).toHaveCount(44);
      await page.getByRole("button", { name: "編集", exact: true }).click();
      await page.getByLabel("体重(kg)", { exact: true }).fill("80");
      network.fail = true;
      await page.getByRole("button", { name: "測定を正式保存" }).click();
      await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
        "正式保存",
      );
      network.fail = false;
      expect(
        (await bodyRepo.list()).filter((r) => fixtures.has(a.label, r.id)),
      ).toEqual(own);
      await page.getByRole("button", { name: "測定を正式保存" }).click();
      await expect(
        page.getByRole("button", { name: "編集", exact: true }),
      ).toBeVisible({ timeout: 15000 });
      await page.getByRole("button", { name: "測定詳細を閉じる" }).click();
      await expect(
        page.getByRole("region", { name: "最新4指標" }),
      ).toContainText("80");
      await page.reload();
      await expect(
        page.getByRole("region", { name: "最新4指標" }),
      ).toContainText("80");
      await page.getByRole("button", { name: "表示中の測定詳細" }).click();
      page.once("dialog", (d) => d.accept());
      await page.getByRole("button", { name: "この測定を削除" }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(
        page.getByRole("region", { name: "最新4指標" }),
      ).toContainText("70");
      await expect(page.locator("svg circle")).toHaveCount(1);
      expect(await trainRepo.workouts()).toEqual(beforeWorkouts);
      expect(prs(await trainRepo.workouts())).toEqual(beforePrs);
      expect(await goalRepo.list()).toEqual(beforeGoals);
      const otherCount = (
        await new InBodyRepository(other.client, other.userId).list()
      ).length;
      await page
        .getByRole("button", { name: "ログアウト", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "ログイン", exact: true }),
      ).toBeVisible();
      await login(page, other.label);
      await expect(
        page.getByRole("button", {
          name: `測定履歴を開く（${otherCount}件）`,
          exact: true,
        }),
      ).toBeVisible();
    } finally {
      await context.close();
      const remaining = await fixtures.cleanup(accounts),
        remainingTraining = await training.cleanup(accounts);
      for (const a of accounts) await a.client.auth.signOut({ scope: "local" });
      expect(remaining).toBe(0);
      expect(remainingTraining).toBe(0);
    }
  });
test.use({ timezoneId: "Asia/Tokyo", viewport: { width: 390, height: 844 } });
