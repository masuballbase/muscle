import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { TrainingRepository } from "../../src/lib/training/repository";
import { type Workout, type Exercise } from "../../src/lib/training/model";
const journalPath = "/tmp/muscle-phase2-browser-fixtures.json";
const journal: { account: string; table: string; id: string }[] = existsSync(
  journalPath,
)
  ? JSON.parse(readFileSync(journalPath, "utf8"))
  : [];
if (journal.length)
  throw new Error(
    "Outstanding Phase 2 fixtures: run npm run verify:phase2:cleanup first",
  );
function track(account: string, table: string, id: string) {
  if (!journal.some((e) => e.table === table && e.id === id)) {
    journal.push({ account, table, id });
    writeFileSync(journalPath, JSON.stringify(journal), { mode: 0o600 });
  }
}
async function login(label: string) {
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data, error } = await client.auth.signInWithPassword({
    email: process.env[`MUSCLE_TEST_${label}_EMAIL`]!,
    password: process.env[`MUSCLE_TEST_${label}_PASSWORD`]!,
  });
  if (error || !data.user) throw new Error("Test authentication failed");
  return { client, userId: data.user.id };
}
async function browserLogin(page: Page, label: string) {
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
async function transport(
  context: BrowserContext,
  label: string,
  userId: string,
) {
  const network = { offline: false, loseResponse: false, lostResponse: false };
  await context.route(
    "https://mcuiikilwrxuylwuljmk.supabase.co/**",
    async (route) => {
      const request = route.request();
      try {
        const url = new URL(request.url());
        if (network.offline && url.pathname.startsWith("/rest/v1/")) {
          await route.abort("internetdisconnected");
          return;
        }
        const table = url.pathname.split("/").at(-1)!;
        if (request.method() === "POST" && table === "sync_training_session") {
          const body = JSON.parse(request.postData()!);
          const w = body.p_workout;
          for (const [target, id] of [
            ["sessions", w.id],
            ...w.sections.flatMap(
              (s: { id: string; sets: { id: string }[] }) => [
                ["session_exercises", s.id],
                ...s.sets.map((set) => ["workout_sets", set.id]),
              ],
            ),
          ]) {
            if (
              !journal.some(
                (e) => e.account === label && e.table === target && e.id === id,
              )
            ) {
              const checked = await fetch(
                `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${target}?id=eq.${id}&user_id=eq.${userId}&select=id`,
                {
                  headers: {
                    apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
                    Authorization: request.headers().authorization,
                  },
                },
              );
              if (!checked.ok || (await checked.json()).length)
                throw new Error("Refusing an existing fixture row");
              track(label, target, id);
            }
          }
        }
        if (
          request.method() === "POST" &&
          [
            "exercises",
            "sessions",
            "session_exercises",
            "workout_sets",
          ].includes(table)
        ) {
          const body = JSON.parse(request.postData()!);
          for (const row of Array.isArray(body) ? body : [body]) {
            if (row.user_id !== userId)
              throw new Error("Unexpected test owner");
            track(label, table, row.id);
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
        if (
          network.loseResponse && response.ok &&
          request.method() === "POST" && table === "sync_training_session"
        ) {
          await response.arrayBuffer(); // DB committed; deliberately hide only its success response.
          network.loseResponse = false;
          network.lostResponse = true;
          await route.abort("connectionreset");
          return;
        }
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
async function cleanup(label: string, client: SupabaseClient, userId: string) {
  for (const table of [
    "workout_sets",
    "session_exercises",
    "sessions",
    "exercises",
  ])
    for (const entry of journal.filter(
      (e) => e.account === label && e.table === table,
    )) {
      const { error } = await client
        .from(table)
        .delete()
        .eq("id", entry.id)
        .eq("user_id", userId);
      if (error) throw new Error(`Fixture cleanup failed: ${table}`);
      const remaining = await client
        .from(table)
        .select("id")
        .eq("id", entry.id)
        .eq("user_id", userId);
      if (remaining.error || remaining.data?.length)
        throw new Error("Fixture remains");
      const index = journal.indexOf(entry);
      journal.splice(index, 1);
      writeFileSync(journalPath, JSON.stringify(journal), { mode: 0o600 });
    }
}
for (const label of ["A", "B"])
  test(`Phase 2 ${label}: exercises, copy, PR, restore, finish and isolation`, async ({
    page,
    context,
  }) => {
    test.setTimeout(180000);
    page.setDefaultTimeout(15000);
    const { client, userId } = await login(label);
    const other = await login(label === "A" ? "B" : "A");
    const active = await client
      .from("sessions")
      .select("id")
      .eq("user_id", userId)
      .eq("status", "active")
      .limit(1);
    test.skip(
      !!active.error || !!active.data?.length,
      "Existing active session: leave real data untouched",
    );
    const marker = `phase2-${randomUUID()}`;
    const exercise: Exercise = {
      id: randomUUID(),
      name: `${marker}-weight`,
      record_type: "weight_reps",
      archived_at: null,
    };
    const repo = new TrainingRepository(client, userId);
    track(label, "exercises", exercise.id);
    try {
      await repo.saveExercise(exercise, true);
      const duplicateId = randomUUID();
      track(label, "exercises", duplicateId);
      const duplicate = await client.from("exercises").insert({
        id: duplicateId,
        user_id: userId,
        name: ` ${exercise.name} `,
        record_type: "reps",
      });
      expect(duplicate.error?.code).toBe("23505");
      const extraExercises: Exercise[] = [
        {
          id: randomUUID(),
          name: `${marker}-reps`,
          record_type: "reps",
          archived_at: null,
        },
        {
          id: randomUUID(),
          name: `${marker}-duration`,
          record_type: "duration",
          archived_at: null,
        },
      ];
      for (const extra of extraExercises) {
        track(label, "exercises", extra.id);
        await repo.saveExercise(extra, true);
      }

      const previous: Workout = {
        id: randomUUID(),
        name: marker,
        startedAt: "2025-01-01T01:00:00Z",
        endedAt: "2025-01-01T01:10:00Z",
        revision: 1,
        syncedRevision: 0,
        sections: [
          {
            id: randomUUID(),
            exerciseId: exercise.id,
            name: exercise.name,
            type: "weight_reps",
            sets: [
              {
                id: randomUUID(),
                weight: "50",
                reps: "5",
                seconds: "",
                performed: true,
                copied: false,
              },
            ],
          },
        ],
      };
      track(label, "sessions", previous.id);
      track(label, "session_exercises", previous.sections[0].id);
      track(label, "workout_sets", previous.sections[0].sets[0].id);
      await repo.sync(previous);
      const hidden = await other.client
        .from("exercises")
        .select("id")
        .eq("id", exercise.id);
      expect(hidden.error).toBeNull();
      expect(hidden.data).toEqual([]);
      await page.setViewportSize({ width: 375, height: 812 });
      const network = await transport(context, label, userId);
      await browserLogin(page, label);
      // Actual exercise creation/editing/deletion through the application.
      await page.getByRole("button", { name: "種目管理", exact: true }).click();
      await page
        .getByRole("button", { name: "種目を登録", exact: true })
        .click();
      await page.getByLabel("種目名", { exact: true }).fill(`${marker}-unused`);
      await page.getByLabel("記録タイプ", { exact: true }).selectOption("reps");
      await page.getByRole("button", { name: "保存", exact: true }).click();
      const unused = page.getByRole("button", {
        name: new RegExp(`${marker}-unused`),
      });
      await unused.click();
      await page
        .getByLabel("記録タイプ", { exact: true })
        .selectOption("duration");
      await page.getByLabel("種目名", { exact: true }).fill(`${marker}-edited`);
      await page.getByRole("button", { name: "保存", exact: true }).click();
      await page
        .getByRole("button", { name: new RegExp(`${marker}-edited`) })
        .click();
      page.once("dialog", (dialog) => dialog.accept());
      await page
        .getByRole("button", { name: "この種目を削除", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: new RegExp(`${marker}-edited`) }),
      ).toHaveCount(0);
      await page
        .getByRole("button", { name: new RegExp(exercise.name) })
        .click();
      await expect(
        page.getByLabel("記録タイプ", { exact: true }),
      ).toBeDisabled();
      await page
        .getByRole("button", { name: "キャンセル", exact: true })
        .click();
      await page
        .getByRole("button", { name: "種目管理を閉じる", exact: true })
        .click();
      await page
        .getByRole("button", { name: "自由に開始", exact: true })
        .click();
      await expect(page.getByRole("navigation")).toHaveCount(0);
      const currentId = await page
        .locator("[data-workout-id]")
        .getAttribute("data-workout-id");
      expect(currentId).toBeTruthy();
      track(label, "sessions", currentId!);
      await page
        .getByRole("button", { name: "種目を追加", exact: true })
        .click();
      await page
        .getByRole("dialog", { name: "種目を追加", exact: true })
        .getByRole("button", { name: new RegExp(exercise.name) })
        .first()
        .click();
      const weight = page.getByLabel(`${exercise.name} セット1 重量（kg）`, {
        exact: true,
      });
      const reps = page.getByLabel(`${exercise.name} セット1 回数`, {
        exact: true,
      });
      await expect(weight).toHaveValue("50");
      await expect(reps).toHaveValue("");
      await reps.fill("6");
      await expect(page.getByText("✓ 実施済み", { exact: true })).toHaveCount(
        0,
      );
      await page
        .getByRole("heading", { name: "トレーニング", exact: true })
        .click();
      await expect(page.getByText("✓ 実施済み", { exact: true })).toHaveCount(
        1,
      );
      await expect(page.getByText(/暫定PR更新/)).toBeVisible();
      page.once("dialog", (dialog) => dialog.accept());
      await page
        .getByRole("button", { name: "この行をコピー", exact: true })
        .click();
      await reps.fill("8");
      await page
        .getByRole("heading", { name: "トレーニング", exact: true })
        .click();
      await expect(
        page.getByText("コピー由来・未実施", { exact: true }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "実施済みにする", exact: true })
        .click();
      await expect(page.getByText("✓ 実施済み", { exact: true })).toHaveCount(
        1,
      );
      await page
        .getByRole("button", { name: "種目を追加", exact: true })
        .click();
      await page
        .getByRole("dialog", { name: "種目を追加", exact: true })
        .getByRole("button", { name: new RegExp(exercise.name) })
        .first()
        .click();
      await expect(page.locator(".workout-section")).toHaveCount(1);
      await expect(page.locator(".set-row")).toHaveCount(2);
      await expect(page.locator(".save-status")).toContainText("同期済み", {
        timeout: 30000,
      });
      const duplicateSessionId = randomUUID();
      track(label, "sessions", duplicateSessionId);
      const duplicateSession = await client.from("sessions").insert({
        id: duplicateSessionId,
        user_id: userId,
        name: marker,
        started_at: new Date().toISOString(),
        ended_at: null,
        status: "active",
        revision: 1,
      });
      expect(duplicateSession.error?.code).toBe("23505");

      page.once("dialog", (dialog) => dialog.accept());
      await page
        .getByRole("button", { name: "セット2を削除", exact: true })
        .click();
      await expect(page.locator(".set-row")).toHaveCount(1);
      await expect(page.locator(".save-status")).toContainText("同期済み", {
        timeout: 30000,
      });
      await page
        .getByRole("button", { name: "セットを追加", exact: true })
        .click();
      for (const extra of extraExercises) {
        await page
          .getByRole("button", { name: "種目を追加", exact: true })
          .click();
        await page
          .getByRole("dialog", { name: "種目を追加", exact: true })
          .getByRole("button", { name: new RegExp(extra.name) })
          .first()
          .click();
        const field = page.getByLabel(
          `${extra.name} セット1 ${extra.record_type === "reps" ? "回数" : "時間（秒）"}`,
          { exact: true },
        );
        await field.fill(extra.record_type === "reps" ? "20" : "45");
        await page
          .getByRole("heading", { name: "トレーニング", exact: true })
          .click();
      }
      await expect(page.getByText("✓ 実施済み", { exact: true })).toHaveCount(
        1,
      );
      await expect(page.locator(".workout-section")).toHaveCount(3);

      await page
        .getByRole("button", { name: "記録トップへ戻る", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "トレーニングを再開", exact: true }),
      ).toBeVisible();
      await page.reload();
      await expect(
        page.getByRole("button", { name: "トレーニングを再開", exact: true }),
      ).toBeVisible();
      await expect(page.locator(".training-full")).toHaveCount(0);
      await page
        .getByRole("navigation")
        .getByRole("link", { name: "履歴", exact: true })
        .click();
      await page
        .getByRole("link", { name: "進行中のトレーニングを再開", exact: true })
        .click();
      await expect(page.locator(".training-full")).toBeVisible();
      await expect(page.locator("[data-workout-id]")).toHaveAttribute(
        "data-workout-id",
        currentId!,
      );
      await expect(
        page.getByLabel(`${exercise.name} セット1 回数`, { exact: true }),
      ).toHaveValue("8");
      if (label === "B") network.offline = true;
      await page
        .getByRole("button", { name: "トレーニングを終了", exact: true })
        .click();
      await expect(page.getByText(/未実施セットが1件/)).toBeVisible();
      await page
        .getByRole("button", { name: "終了を確定", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "トレーニング完了", exact: true }),
      ).toBeVisible();
      if (label === "B") {
        await expect(
          page.getByText("終了済み・未同期（同期後に正式反映）", {
            exact: true,
          }),
        ).toBeVisible();
        await page.reload();
        await expect(
          page.getByRole("heading", { name: "トレーニング完了", exact: true }),
        ).toBeVisible();
        await expect(
          page.getByRole("button", { name: "トレーニングを再開", exact: true }),
        ).toHaveCount(0);
        await page
          .getByRole("navigation")
          .getByRole("link", { name: "履歴", exact: true })
          .click();
        await expect(
          page.getByRole("region", {
            name: "未同期の終了済みトレーニング",
            exact: true,
          }),
        ).toBeVisible();
        await page
          .getByRole("navigation")
          .getByRole("link", { name: "記録", exact: true })
          .click();
        network.loseResponse = true;
        network.offline = false;
        await page.evaluate(() => window.dispatchEvent(new Event("online")));
        await expect.poll(() => network.lostResponse, { timeout: 30000 }).toBe(true);
        await expect(page.locator(".save-status")).toContainText("未同期");
        const committed = await client.from("sessions").select("*")
          .eq("user_id", userId).eq("id", currentId!);
        expect(committed.error).toBeNull();
        expect(committed.data?.[0]?.status).toBe("completed");
        await page.getByRole("button", { name: "保存を再試行", exact: true }).click();
        await expect(page.locator(".save-status")).toContainText("同期済み", { timeout: 30000 });
        const replayed = await client.from("sessions").select("*")
          .eq("user_id", userId).eq("id", currentId!);
        expect(replayed.error).toBeNull();
        expect(replayed.data).toEqual(committed.data);
      }
      await expect
        .poll(
          async () => {
            const r = await client
              .from("sessions")
              .select("status")
              .eq("user_id", userId)
              .eq("id", currentId!);
            return r.data?.[0]?.status;
          },
          { timeout: 30000 },
        )
        .toBe("completed");
      const performed = await client
        .from("session_exercises")
        .select("id")
        .eq("session_id", currentId!)
        .eq("user_id", userId);
      const rows = await client
        .from("workout_sets")
        .select("reps,duration_seconds,record_type,is_performed")
        .in(
          "session_exercise_id",
          performed.data!.map((s) => s.id),
        )
        .eq("user_id", userId);
      expect(rows.data).toHaveLength(3);
      expect(rows.data).toEqual(
        expect.arrayContaining([
          {
            reps: 8,
            duration_seconds: null,
            record_type: "weight_reps",
            is_performed: true,
          },
          {
            reps: 20,
            duration_seconds: null,
            record_type: "reps",
            is_performed: true,
          },
          {
            reps: null,
            duration_seconds: 45,
            record_type: "duration",
            is_performed: true,
          },
        ]),
      );
      await expect(page.locator(".save-status")).toContainText("同期済み", {
        timeout: 30000,
      });
      const otherWorkouts = await other.client
        .from("sessions")
        .select("id")
        .eq("id", currentId!);
      expect(otherWorkouts.data).toEqual([]);
      // Soft delete must preserve both original and new historical snapshots.
      await page.getByRole("button", { name: "種目管理", exact: true }).click();
      await page
        .getByRole("button", { name: new RegExp(exercise.name) })
        .click();
      page.once("dialog", (dialog) => dialog.accept());
      await page
        .getByRole("button", { name: "この種目を削除", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: new RegExp(exercise.name) }),
      ).toHaveCount(0);
      const history = await client
        .from("session_exercises")
        .select("exercise_name_snapshot")
        .eq("exercise_id", exercise.id)
        .eq("user_id", userId);
      expect(history.data).toHaveLength(2);
      expect(
        history.data!.every((s) => s.exercise_name_snapshot === exercise.name),
      ).toBe(true);
    } finally {
      try {
        await context.unrouteAll({ behavior: "wait" });
        await context.close();
      } finally {
        try {
          await cleanup(label, client, userId);
        } finally {
          await client.auth.signOut({ scope: "local" });
          await other.client.auth.signOut({ scope: "local" });
        }
      }
    }
  });
