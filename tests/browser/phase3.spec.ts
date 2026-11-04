// Real Chromium + local PostgreSQL/RLS. This test NEVER sends requests to Supabase.
import { test, expect, type BrowserContext } from "@playwright/test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { dayKey } from "../../src/lib/history/model";
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const USER = id(1),
  EA = id(10),
  EB = id(11),
  HISTORY = id(30),
  SECTION = id(31),
  SET = id(32);
const allowed: Record<string, string[]> = {
  exercises: ["id", "user_id", "name", "record_type", "archived_at"],
  menus: ["id", "user_id", "name"],
  menu_items: [
    "id",
    "user_id",
    "menu_id",
    "exercise_id",
    "position",
    "planned_sets",
  ],
  sessions: [
    "id",
    "user_id",
    "name",
    "started_at",
    "ended_at",
    "status",
    "revision",
  ],
  session_exercises: [
    "id",
    "user_id",
    "session_id",
    "exercise_id",
    "exercise_name_snapshot",
    "record_type_snapshot",
    "position",
  ],
  workout_sets: [
    "id",
    "user_id",
    "session_exercise_id",
    "record_type",
    "position",
    "weight_kg",
    "reps",
    "duration_seconds",
    "is_performed",
    "is_copied",
  ],
};
let db: PGlite;
let failRpc = false;
let startDay: string;
let zeroDay: string;
async function prepare(context: BrowserContext) {
  db = new PGlite();
  await db.exec(readFileSync("tests/sql/phase3-fixture.sql", "utf8"));
  await db.exec(readFileSync("db/proposals/phase3-atomic-writes.sql", "utf8"));
  const start = new Date();
  start.setDate(start.getDate() - 1);
  start.setUTCHours(14, 50, 0, 0);
  const end = new Date(start.getTime() + 40 * 60000);
  startDay = dayKey(start);
  const zero = new Date(start.getTime() - 86400000);
  zeroDay = dayKey(zero);
  await db.query(
    "INSERT INTO exercises VALUES($1,$2,$3,$4,null),($5,$2,$6,$7,null)",
    [EA, USER, "テスト種目A", "weight_reps", EB, "テスト種目B", "reps"],
  );
  await db.query("INSERT INTO sessions VALUES($1,$2,$3,$4,$5,$6,1)", [
    HISTORY,
    USER,
    "日付またぎの記録",
    start.toISOString(),
    end.toISOString(),
    "completed",
  ]);
  await db.query("INSERT INTO session_exercises VALUES($1,$2,$3,$4,$5,$6,0)", [
    SECTION,
    USER,
    HISTORY,
    EA,
    "当時の種目名",
    "weight_reps",
  ]);
  await db.query(
    "INSERT INTO workout_sets VALUES($1,$2,$3,$4,0,50,5,null,true,false)",
    [SET, USER, SECTION, "weight_reps"],
  );
  await db.query("INSERT INTO sessions VALUES($1,$2,$3,$4,$5,$6,1)", [
    id(40),
    USER,
    "0セットの記録",
    new Date(start.getTime() - 86400000).toISOString(),
    new Date(start.getTime() - 86340000).toISOString(),
    "completed",
  ]);
  failRpc = false;
  await context.route(
    "https://mcuiikilwrxuylwuljmk.supabase.co/**",
    async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const user = {
        id: USER,
        email: "local-test@example.invalid",
        aud: "authenticated",
        role: "authenticated",
        app_metadata: {},
        user_metadata: {},
        created_at: new Date().toISOString(),
      };
      if (url.pathname.startsWith("/auth/v1/")) {
        const body = url.pathname.endsWith("/token")
          ? {
              access_token: "local-test-only",
              refresh_token: "local-refresh-only",
              token_type: "bearer",
              expires_in: 3600,
              user,
            }
          : url.pathname.endsWith("/user")
            ? user
            : {};
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(body),
        });
        return;
      }
      if (!url.pathname.startsWith("/rest/v1/")) {
        await route.abort();
        return;
      }
      try {
        const table = url.pathname.split("/").at(-1)!;
        const rpc = url.pathname.includes("/rpc/");
        if (rpc && failRpc) {
          await route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({
              code: "TEST_FAILURE",
              message: "Injected transport failure",
            }),
          });
          return;
        }
        const result = await db.transaction(async (tx) => {
          await tx.exec("SET LOCAL ROLE authenticated");
          await tx.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [
            USER,
          ]);
          if (rpc) {
            const p = JSON.parse(request.postData()!);
            let sql: string;
            let args: unknown[];
            if (table === "save_training_menu") {
              sql =
                "SELECT public.save_training_menu($1,$2,$3::jsonb,$4::jsonb) AS value";
              args = [
                p.p_id,
                p.p_name,
                JSON.stringify(p.p_items),
                p.p_expected === null ? null : JSON.stringify(p.p_expected),
              ];
            } else if (table === "edit_training_history") {
              sql =
                "SELECT public.edit_training_history($1,$2,$3,$4,$5::jsonb) AS value";
              args = [
                p.p_id,
                p.p_revision,
                p.p_name,
                p.p_ended_at,
                JSON.stringify(p.p_sections),
              ];
            } else if (table === "archive_training_exercise") {
              sql = "SELECT public.archive_training_exercise($1) AS value";
              args = [p.p_id];
            } else throw new Error("Unknown test RPC");
            return (await tx.query<{ value: unknown }>(sql, args)).rows[0]
              .value;
          }
          const columns = allowed[table];
          if (!columns) throw new Error("Unknown test table");
          const quote = (key: string) => {
            if (!columns.includes(key)) throw new Error("Invalid test column");
            return `"${key}"`;
          };
          const params: unknown[] = [];
          const clauses: string[] = [];
          for (const [key, value] of url.searchParams) {
            if (!columns.includes(key)) continue;
            if (value.startsWith("eq.")) {
              params.push(value.slice(3));
              clauses.push(`${quote(key)}=$${params.length}`);
            } else if (value.startsWith("in.(")) {
              const values = value.slice(4, -1).split(",");
              const placeholders = values.map((value) => {
                params.push(value.replace(/^"|"$/g, ""));
                return `$${params.length}`;
              });
              clauses.push(`${quote(key)} IN (${placeholders.join(",")})`);
            } else if (value === "is.null")
              clauses.push(`${quote(key)} IS NULL`);
          }
          const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
          if (request.method() === "GET") {
            let order = "";
            const orderKey = url.searchParams.get("order")?.split(".")[0];
            if (orderKey && columns.includes(orderKey))
              order = ` ORDER BY ${quote(orderKey)}`;
            const limit = Math.min(
              500,
              Math.max(0, Number(url.searchParams.get("limit") ?? 500)),
            );
            const offset = Math.max(
              0,
              Number(url.searchParams.get("offset") ?? 0),
            );
            return (
              await tx.query(
                `SELECT * FROM public.${table}${where}${order} LIMIT ${limit} OFFSET ${offset}`,
                params,
              )
            ).rows;
          }
          if (request.method() === "DELETE")
            return (
              await tx.query(
                `DELETE FROM public.${table}${where} RETURNING *`,
                params,
              )
            ).rows;
          if (request.method() === "PATCH") {
            const body = JSON.parse(request.postData()!);
            const entries = Object.entries(body);
            const set = entries
              .map(([key, value]) => {
                params.push(value);
                return `${quote(key)}=$${params.length}`;
              })
              .join(",");
            return (
              await tx.query(
                `UPDATE public.${table} SET ${set}${where} RETURNING *`,
                params,
              )
            ).rows;
          }
          if (request.method() === "POST") {
            const body = JSON.parse(request.postData()!);
            const rows = Array.isArray(body) ? body : [body];
            const saved: unknown[] = [];
            for (const row of rows) {
              const entries = Object.entries(row);
              const keys = entries.map(([key]) => quote(key));
              const values = entries.map(([, value]) => value);
              const update = entries
                .filter(([key]) => key !== "id")
                .map(([key]) => `${quote(key)}=EXCLUDED.${quote(key)}`)
                .join(",");
              const upsert = request
                .headers()
                .prefer?.includes("resolution=merge-duplicates")
                ? ` ON CONFLICT(id) DO UPDATE SET ${update}`
                : "";
              saved.push(
                ...(
                  await tx.query(
                    `INSERT INTO public.${table}(${keys.join(",")}) VALUES(${values.map((_, index) => `$${index + 1}`).join(",")})${upsert} RETURNING *`,
                    values,
                  )
                ).rows,
              );
            }
            return saved;
          }
          throw new Error("Unknown test request");
        });
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(result),
        });
      } catch (error) {
        const code =
          error && typeof error === "object" && "code" in error
            ? String(error.code)
            : "TEST_BACKEND_ERROR";
        await route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({
            code,
            message: "Request rejected by local test database",
          }),
        });
      }
    },
  );
}
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
  failRpc = true;
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
  failRpc = false;
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
  failRpc = true;
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
  failRpc = false;
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
