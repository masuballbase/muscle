// Real Supabase Auth and RPC integration. Only journaled dedicated UUIDs may be mutated.
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { loginClients } from "../../scripts/lib/test-clients.mjs";
import { Phase3Fixtures } from "../../scripts/lib/phase3-fixtures.mjs";
const fixtures = new Phase3Fixtures("/tmp/muscle-phase3-browser-fixtures.json");
async function loginPage(page: Page, label: string) {
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
) {
  const network = { failRpc: false };
  await context.route(
    "https://mcuiikilwrxuylwuljmk.supabase.co/**",
    async (route) => {
      const request = route.request();
      try {
        const url = new URL(request.url());
        const table = url.pathname.split("/").at(-1)!;
        const rpc = url.pathname.includes("/rpc/");
        if (rpc && network.failRpc) {
          await route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({
              code: "TEST_TRANSPORT_FAILURE",
              message: "Injected transport failure",
            }),
          });
          return;
        }
        if (
          url.pathname.startsWith("/rest/v1/") &&
          request.method() !== "GET" &&
          request.method() !== "HEAD"
        ) {
          const body = request.postData()
            ? JSON.parse(request.postData()!)
            : null;
          if (rpc) {
            if (table === "sync_training_session") {
              const w = body.p_workout;
              await fixtures.reserve(account, "sessions", w.id);
              for (const s of w.sections) {
                if (!fixtures.has(account.label, "exercises", s.exerciseId))
                  throw new Error("Unexpected exercise");
                await fixtures.reserve(account, "session_exercises", s.id);
                for (const set of s.sets)
                  await fixtures.reserve(account, "workout_sets", set.id);
              }
            } else if (table === "save_training_menu") {
              if (
                body.p_expected !== null &&
                !fixtures.has(account.label, "menus", body.p_id)
              )
                throw new Error("Refusing existing menu mutation");
              await fixtures.reserve(account, "menus", body.p_id);
              for (const item of body.p_items) {
                if (!fixtures.has(account.label, "exercises", item.exerciseId))
                  throw new Error("Unexpected fixture exercise");
                await fixtures.reserve(account, "menu_items", item.id);
              }
            } else if (table === "edit_training_history") {
              if (!fixtures.has(account.label, "sessions", body.p_id))
                throw new Error("Refusing existing history mutation");
              for (const section of body.p_sections) {
                if (
                  !fixtures.has(account.label, "exercises", section.exerciseId)
                )
                  throw new Error("Unexpected exercise");
                await fixtures.reserve(
                  account,
                  "session_exercises",
                  section.id,
                );
                for (const set of section.sets)
                  await fixtures.reserve(account, "workout_sets", set.id);
              }
            } else if (table === "archive_training_exercise") {
              if (!fixtures.has(account.label, "exercises", body.p_id))
                throw new Error("Refusing existing exercise archive");
            } else throw new Error("Unexpected write RPC");
          } else if (request.method() === "POST") {
            for (const row of Array.isArray(body) ? body : [body]) {
              if (row.user_id !== account.userId)
                throw new Error("Unexpected owner");
              await fixtures.reserve(account, table, row.id);
            }
          } else {
            const filter = url.searchParams.get("id");
            if (
              !filter?.startsWith("eq.") ||
              !fixtures.has(account.label, table, filter.slice(3)) ||
              url.searchParams.get("user_id") !== `eq.${account.userId}`
            )
              throw new Error("Refusing untracked mutation");
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
        delete output["content-encoding"];
        delete output["content-length"];
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
  test(`Phase 3 live ${label}: history-derived menu, draft, RPC failure, apply, edit and archive`, async ({
    page,
    context,
  }) => {
    test.setTimeout(180000);
    page.setDefaultTimeout(15000);
    fixtures.requireEmpty();
    const accounts = await loginClients();
    const a = accounts.find((account) => account.label === label)!;
    const other = accounts.find((account) => account.label !== label)!;
    const marker = `phase3-browser-${randomUUID()}`;
    const exercise = randomUUID(),
      history = randomUUID(),
      section = randomUUID(),
      set = randomUUID();
    let currentId: string | null = null;
    try {
      const active = await a.client
        .from("sessions")
        .select("id")
        .eq("user_id", a.userId)
        .eq("status", "active")
        .limit(1);
      if (active.error) throw new Error("Cannot check active sessions");
      test.skip(
        active.data.length > 0,
        "Existing active session; do not touch real data",
      );
      const seed = async (table: string, row: Record<string, unknown>) => {
        await fixtures.reserve(a, table, row.id);
        const result = await a.client
          .from(table)
          .insert({ ...row, user_id: a.userId });
        if (result.error)
          throw new Error(`Fixture create rejected (${result.error.code})`);
      };
      const start = new Date(Date.now() - 86400000).toISOString();
      const end = new Date(Date.now() - 85800000).toISOString();
      await seed("exercises", {
        id: exercise,
        name: `${marker}-exercise`,
        record_type: "weight_reps",
      });
      await seed("sessions", {
        id: history,
        name: `${marker}-history`,
        started_at: start,
        ended_at: end,
        status: "completed",
        revision: 1,
      });
      await seed("session_exercises", {
        id: section,
        session_id: history,
        exercise_id: exercise,
        exercise_name_snapshot: `${marker}-snapshot`,
        record_type_snapshot: "weight_reps",
        position: 0,
      });
      await seed("workout_sets", {
        id: set,
        session_exercise_id: section,
        record_type: "weight_reps",
        position: 0,
        weight_kg: 50,
        reps: 5,
        is_performed: true,
        is_copied: false,
      });
      const network = await connect(context, a);
      await page.setViewportSize({ width: 390, height: 844 });
      await loginPage(page, label);
      await page
        .getByRole("button", { name: "メニュー管理", exact: true })
        .click();
      await page.getByRole("button", { name: "新規作成", exact: true }).click();
      await page
        .getByRole("button", { name: "終了済み履歴から作成", exact: true })
        .click();
      await page
        .getByRole("button", { name: new RegExp(`${marker}-history`) })
        .click();
      await page
        .getByLabel("メニュー名", { exact: true })
        .fill(`${marker}-menu`);
      await page
        .getByLabel(`${marker}-exerciseの予定セット数`, { exact: true })
        .fill("3");
      await page
        .getByRole("button", { name: "正式メニューを保存", exact: true })
        .click();
      await expect(page.getByText("正式保存済み", { exact: true })).toBeVisible(
        { timeout: 20000 },
      );
      const card = page
        .locator("article.menu-card")
        .filter({ hasText: `${marker}-menu` });
      await card.getByRole("button").first().click();
      await page
        .getByLabel("メニュー名", { exact: true })
        .fill(`${marker}-draft`);
      await expect(
        page.getByText("端末下書き保存済み", { exact: true }),
      ).toBeVisible();
      network.failRpc = true;
      await page
        .getByRole("button", { name: "正式メニューを保存", exact: true })
        .click();
      await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
        "正式保存を確認できません",
      );
      const savedMenu = await a.client
        .from("menus")
        .select("id,name")
        .eq("user_id", a.userId)
        .eq("name", `${marker}-menu`);
      expect(savedMenu.data).toHaveLength(1);
      const menuId = savedMenu.data![0].id;
      await page
        .getByRole("button", { name: "下書きを残して閉じる", exact: true })
        .click();
      await page.reload();
      await expect(
        page.getByRole("button", { name: "自由に開始", exact: true }),
      ).toBeVisible();
      network.failRpc = false;
      await page
        .getByRole("button", { name: "メニュー管理", exact: true })
        .click();
      await card.getByRole("button").first().click();
      await page
        .getByRole("button", { name: "下書きを再開", exact: true })
        .click();
      await expect(page.getByLabel("メニュー名", { exact: true })).toHaveValue(
        `${marker}-draft`,
      );
      await page
        .getByRole("button", { name: "この下書きを破棄", exact: true })
        .click({ trial: true });
      page.once("dialog", (dialog) => dialog.accept());
      await page
        .getByRole("button", { name: "この下書きを破棄", exact: true })
        .click();
      await expect(card).toBeVisible();
      await page
        .getByRole("button", { name: "メニュー管理を閉じる", exact: true })
        .click();
      const choose = async () => {
        await page
          .locator("article.menu-card")
          .filter({ hasText: `${marker}-menu` })
          .getByRole("button")
          .first()
          .click();
        await page
          .getByRole("button", { name: "このメニューを確定", exact: true })
          .click();
      };
      await page
        .getByRole("button", { name: "メニューから開始", exact: true })
        .click();
      await page
        .locator("article.menu-card")
        .filter({ hasText: `${marker}-menu` })
        .getByRole("button")
        .first()
        .click();
      expect(
        (
          await a.client
            .from("sessions")
            .select("id")
            .eq("user_id", a.userId)
            .eq("status", "active")
        ).data,
      ).toHaveLength(0);
      await page
        .getByRole("button", { name: "このメニューを確定", exact: true })
        .click();
      await expect(page.locator(".set-row")).toHaveCount(3);
      currentId = await page
        .locator("[data-workout-id]")
        .getAttribute("data-workout-id");
      await page
        .getByRole("button", { name: "メニューを適用", exact: true })
        .click();
      await choose();
      await expect(page.locator(".set-row")).toHaveCount(3);
      await expect(
        page.getByLabel(`${marker}-exercise セット1 重量（kg）`, {
          exact: true,
        }),
      ).toHaveValue("50");
      await page
        .getByLabel(`${marker}-exercise セット1 回数`, { exact: true })
        .fill("6");
      await page
        .getByRole("heading", { name: "トレーニング", exact: true })
        .click();
      await page
        .getByRole("button", { name: "トレーニングを終了", exact: true })
        .click();
      await expect(page.getByText(/未実施セットが2件/)).toBeVisible();
      await page
        .getByRole("button", { name: "終了を確定", exact: true })
        .click();
      await expect(page.locator(".save-status")).toContainText("同期済み", {
        timeout: 45000,
      });
      expect(
        (await other.client.from("menus").select("id").eq("id", menuId)).data,
      ).toEqual([]);
      expect(
        (await other.client.from("sessions").select("id").eq("id", currentId!))
          .data,
      ).toEqual([]);
      await page
        .getByRole("navigation")
        .getByRole("link", { name: "履歴", exact: true })
        .click();
      await page
        .getByRole("button", { name: "履歴を種目名で検索", exact: true })
        .click();
      await page.getByLabel("種目名で検索", { exact: true }).fill(marker);
      const recent = page.getByRole("region", {
        name: "直近の記録",
        exact: true,
      });
      await recent
        .getByRole("button", { name: new RegExp(`${marker}-history`) })
        .click();
      await expect(
        page.getByRole("heading", { name: `${marker}-snapshot`, exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: "編集", exact: true }).click();
      await page
        .getByLabel("セッション名", { exact: true })
        .fill(`${marker}-edited`);
      await page
        .getByLabel(`${marker}-snapshot 履歴セット1 重量（kg）`, {
          exact: true,
        })
        .fill("80");
      network.failRpc = true;
      await page
        .getByRole("button", { name: "履歴を正式保存", exact: true })
        .click();
      await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
        "正式保存を確認できません",
      );
      expect(
        Number(
          (
            await a.client
              .from("workout_sets")
              .select("weight_kg")
              .eq("id", set)
          ).data![0].weight_kg,
        ),
      ).toBe(50);
      network.failRpc = false;
      await page
        .getByRole("button", { name: "履歴を正式保存", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: `${marker}-edited`, exact: true }),
      ).toBeVisible({ timeout: 20000 });
      page.once("dialog", (dialog) => dialog.accept());
      await page
        .getByRole("button", { name: "この履歴を削除", exact: true })
        .click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      expect(
        (
          await a.client
            .from("session_exercises")
            .select("id")
            .eq("session_id", history)
        ).data,
      ).toEqual([]);
      await page
        .getByRole("navigation")
        .getByRole("link", { name: "記録", exact: true })
        .click();
      await page.getByRole("button", { name: "種目管理", exact: true }).click();
      await page
        .getByRole("button", { name: new RegExp(`^${marker}-exercise `) })
        .click();
      page.once("dialog", (dialog) => dialog.accept());
      await page
        .getByRole("button", { name: "この種目を削除", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: new RegExp(`^${marker}-exercise `) }),
      ).toHaveCount(0);
      await page
        .getByRole("button", { name: "種目管理を閉じる", exact: true })
        .click();
      await page
        .getByRole("button", { name: "メニュー管理", exact: true })
        .click();
      await expect(card).toContainText("要修正・適用不可");
      await card.getByRole("button").first().click();
      page.once("dialog", (dialog) => dialog.accept());
      await page
        .getByRole("button", { name: "メニューを削除", exact: true })
        .click();
      await expect(card).toHaveCount(0);
      const retained = await a.client
        .from("session_exercises")
        .select("exercise_name_snapshot")
        .eq("session_id", currentId!)
        .eq("exercise_id", exercise);
      expect(retained.data).toHaveLength(1);
      expect(retained.data![0].exercise_name_snapshot).toBe(
        `${marker}-exercise`,
      );
    } finally {
      try {
        await context.unrouteAll({ behavior: "wait" });
        await context.close();
      } finally {
        try {
          expect(await fixtures.cleanup(accounts)).toBe(0);
        } finally {
          for (const account of accounts)
            await account.client.auth.signOut({ scope: "local" });
        }
      }
    }
  });
