// Live A/B browser integration. All mutations are checked against dedicated UUID journals.
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { loginClients } from "../../scripts/lib/test-clients.mjs";
import { Phase3Fixtures } from "../../scripts/lib/phase3-fixtures.mjs";
import { Phase4GoalFixtures } from "../../scripts/lib/phase4-goal-fixtures.mjs";
import { nextMonday } from "../../src/lib/analytics/model";
import { GoalsRepository } from "../../src/lib/analytics/goals-repository";
const training = new Phase3Fixtures("/tmp/muscle-phase4-browser-fixtures.json"),
  goals = new Phase4GoalFixtures();
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
}
async function connect(
  context: BrowserContext,
  account: Awaited<ReturnType<typeof loginClients>>[number],
  goalId: string,
  monday: string,
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
          if (
            !["POST", "PATCH"].includes(request.method()) ||
            !url.pathname.endsWith("/weekly_goal_schedule")
          )
            throw new Error("Unexpected write");
          const body = JSON.parse(request.postData()!);
          const expected =
            request.method() === "POST"
              ? body.user_id === account.userId &&
                body.effective_monday === monday &&
                body.id === goalId
              : url.searchParams.get("user_id") === `eq.${account.userId}` &&
                url.searchParams.get("effective_monday") === `eq.${monday}` &&
                url.searchParams.get("id") === `eq.${goalId}`;
          if (!expected || !goals.has(account.label, goalId, monday))
            throw new Error("Unsafe goal mutation");
          const existing = await account.client
            .from("weekly_goal_schedule")
            .select("id")
            .eq("id", goalId)
            .eq("user_id", account.userId)
            .eq("effective_monday", monday);
          if (existing.error || existing.data.length !== 1)
            throw new Error("Goal fixture not owned");
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
for (const label of ["A", "B"])
  test(`Phase 4 live ${label}: formal analysis, goal save/failure/reload and owner isolation`, async ({
    page,
    context,
  }) => {
    test.setTimeout(180000);
    const accounts = await loginClients(),
      a = accounts.find((a) => a.label === label)!,
      other = accounts.find((a) => a.label !== label)!;
    try {
      training.requireEmpty();
      goals.requireEmpty();
      const monday = nextMonday(new Date(), "Asia/Tokyo"),
        goalId = await goals.create(a, monday);
      const exercise = randomUUID(),
        session = randomUUID(),
        section = randomUUID(),
        set = randomUUID(),
        name = `phase4-${randomUUID()}`;
      for (const [table, row] of [
        ["exercises", { id: exercise, name, record_type: "reps" }],
        [
          "sessions",
          {
            id: session,
            name,
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
            exercise_id: exercise,
            exercise_name_snapshot: name,
            record_type_snapshot: "reps",
            position: 0,
          },
        ],
        [
          "workout_sets",
          {
            id: set,
            session_exercise_id: section,
            record_type: "reps",
            position: 0,
            reps: 7,
            is_performed: true,
            is_copied: false,
          },
        ],
      ] as const) {
        await training.reserve(a, table, row.id);
        const result = await a.client
          .from(table)
          .insert({ ...row, user_id: a.userId });
        if (result.error) throw new Error("Training fixture creation failed");
      }
      const before = await new GoalsRepository(a.client, a.userId).list();
      const network = await connect(context, a, goalId, monday);
      await login(page, label);
      await page
        .getByRole("navigation")
        .getByRole("link", { name: "分析", exact: true })
        .click();
      await page
        .getByRole("searchbox", { name: "種目名で検索", exact: true })
        .fill(name);
      await page
        .getByRole("region", { name: "分析する種目を検索" })
        .getByRole("button", { name, exact: true })
        .click();
      await expect(page.getByRole("region", { name: "正式PR" })).toContainText(
        "7回",
      );
      await expect(page.locator("svg circle")).toHaveCount(1);
      await page
        .getByRole("button", { name: "全体分析へ戻る", exact: true })
        .click();
      const goal = page.getByRole("region", { name: "週間目標", exact: true });
      await goal
        .getByRole("button", { name: "週間目標を変更", exact: true })
        .click();
      await goal.getByLabel("週間目標日数").selectOption("4");
      await goal
        .getByRole("button", { name: "来週の目標を保存", exact: true })
        .click();
      await expect(goal).toContainText(`${monday}からの目標：4日`, {
        timeout: 15000,
      });
      const after = await new GoalsRepository(a.client, a.userId).list();
      expect(after.filter((g) => g.id !== goalId)).toEqual(
        before.filter((g) => g.id !== goalId),
      );
      expect(after.find((g) => g.id === goalId)?.target_days).toBe(4);
      // Other owner must see no row and cannot mutate the dedicated schedule.
      const read = await other.client
        .from("weekly_goal_schedule")
        .select("id")
        .eq("id", goalId);
      expect(read.error).toBeNull();
      expect(read.data).toHaveLength(0);
      for (const query of [
        other.client
          .from("weekly_goal_schedule")
          .update({ target_days: 6 })
          .eq("id", goalId)
          .select("id"),
        other.client
          .from("weekly_goal_schedule")
          .delete()
          .eq("id", goalId)
          .select("id"),
      ]) {
        const result = await query;
        expect(result.error).toBeNull();
        expect(result.data).toHaveLength(0);
      }
      const unchanged = await new GoalsRepository(a.client, a.userId).list();
      expect(unchanged.find((g) => g.id === goalId)?.target_days).toBe(4);
      await goal
        .getByRole("button", { name: "週間目標を変更", exact: true })
        .click();
      await goal.getByLabel("週間目標日数").selectOption("6");
      network.fail = true;
      await goal
        .getByRole("button", { name: "来週の目標を保存", exact: true })
        .click();
      await expect(goal.getByRole("alert")).toContainText(
        "正式保存を確認できません",
      );
      network.fail = false;
      await page.reload();
      await expect(goal).toContainText(`${monday}からの目標：4日`, {
        timeout: 15000,
      });
      // Switch accounts in the same browser to exercise IndexedDB/cache separation.
      await page
        .getByRole("button", { name: "ログアウト", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "ログイン", exact: true }),
      ).toBeVisible();
      await login(page, other.label);
      await page
        .getByRole("navigation")
        .getByRole("link", { name: "分析", exact: true })
        .click();
      await page
        .getByRole("searchbox", { name: "種目名で検索", exact: true })
        .fill(name);
      await expect(
        page
          .getByRole("region", { name: "分析する種目を検索" })
          .getByRole("button", { name, exact: true }),
      ).toHaveCount(0);
    } finally {
      await context.close();
      const remainingGoals = await goals.cleanup(accounts),
        remainingTraining = await training.cleanup(accounts);
      for (const a of accounts) await a.client.auth.signOut({ scope: "local" });
      expect(remainingGoals).toBe(0);
      expect(remainingTraining).toBe(0);
    }
  });
test.use({ timezoneId: "Asia/Tokyo", viewport: { width: 390, height: 844 } });
