// Real Chromium + local PostgreSQL/RLS. This test NEVER sends requests to Supabase.
import { type BrowserContext } from "@playwright/test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { dayKey } from "../../../src/lib/history/model";
export const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const USER = id(1),
  EA = id(10),
  EB = id(11),
  HISTORY = id(30),
  SECTION = id(31),
  SET = id(32);
const allowed: Record<string, string[]> = {
  inbody_records: [
    "id",
    "user_id",
    "measured_on",
    "imported_at",
    "source_filename",
    "raw_fields",
  ],
  weekly_goal_schedule: ["id", "user_id", "effective_monday", "target_days"],
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
export let db: PGlite;
let failRpc = false;
let failInBody = false;
export function setInBodyFailure(value: boolean) {
  failInBody = value;
}
export function setRpcFailure(value: boolean) {
  failRpc = value;
}
export let failGoals = false;
export function setGoalsFailure(value: boolean) {
  failGoals = value;
}
export let startDay: string;
export let zeroDay: string;
export async function prepare(context: BrowserContext, reference = new Date()) {
  db = new PGlite();
  await db.exec(readFileSync("tests/sql/phase3-fixture.sql", "utf8"));
  await db.exec(readFileSync("db/proposals/phase3-atomic-writes.sql", "utf8"));
  await db.exec(
    readFileSync("db/proposals/phase3-conflict-response.sql", "utf8"),
  );
  await db.exec(readFileSync("tests/sql/phase4-fixture.sql", "utf8"));
  await db.exec(readFileSync("tests/sql/phase5-fixture.sql", "utf8"));
  await db.exec(readFileSync("db/proposals/phase6-atomic-sync.sql", "utf8"));
  const start = new Date(reference);
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
  failInBody = false;
  failGoals = false;
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
        if (
          (rpc && failRpc) ||
          (table === "inbody_records" &&
            failInBody &&
            request.method() !== "GET") ||
          (table === "weekly_goal_schedule" &&
            failGoals &&
            request.method() !== "GET")
        ) {
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
            if (table === "sync_training_session") {
              sql =
                "SELECT public.sync_training_session($1::jsonb,$2::jsonb) AS value";
              args = [
                JSON.stringify(p.p_workout),
                JSON.stringify(p.p_expected),
              ];
            } else if (table === "save_training_menu") {
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
                ? ` ON CONFLICT(${(url.searchParams.get("on_conflict") ?? "id").split(",").map(quote).join(",")}) DO UPDATE SET ${update}`
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
          body: JSON.stringify(result, (key, value) =>
            ["effective_monday", "measured_on"].includes(key) &&
            typeof value === "string"
              ? value.slice(0, 10)
              : value,
          ),
        });
      } catch (error) {
        const code =
          error && typeof error === "object" && "code" in error
            ? String(error.code)
            : "TEST_BACKEND_ERROR";
        await route.fulfill({
          status: code === "PT409" ? 409 : 400,
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
