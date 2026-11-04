import { type Menu, validateMenu } from "../menus/model";
import { validateHistory, editableHistory } from "../history/model";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  type Exercise,
  type Workout,
  type Section,
  type SetRecord,
  syncSnapshot,
  SyncConflictError,
} from "./model";
// PostgREST results are checked at each step. No service-role access or schema changes.
export class TrainingRepository {
  constructor(
    private client: SupabaseClient,
    readonly userId: string,
  ) {}
  private async owner() {
    const { data, error } = await this.client.auth.getSession();
    if (error || data.session?.user.id !== this.userId)
      throw new Error("ログイン状態が変わりました。再度ログインしてください。");
  }
  private async result<T>(
    query: PromiseLike<{ data: T[] | null; error: unknown }>,
  ): Promise<T[]> {
    type Bounded = typeof query & {
      retry?: (enabled: boolean) => typeof query;
      abortSignal?: (signal: AbortSignal) => typeof query;
    };
    const once = (query as Bounded).retry?.(false) ?? query;
    const bounded =
      (once as Bounded).abortSignal?.(AbortSignal.timeout(8000)) ?? once;
    const { data, error } = await bounded;
    if (error)
      throw new Error(
        "サーバーへの保存・読み込みに失敗しました。通信状態を確認してください。",
      );
    return data ?? [];
  }
  private table(name: string) {
    return this.client.from(name);
  }
  async exercises(): Promise<Exercise[]> {
    await this.owner();
    const all: Exercise[] = [];
    for (let offset = 0; ; offset += 500) {
      const page = await this.result(
        this.table("exercises")
          .select("id,name,record_type,archived_at")
          .eq("user_id", this.userId)
          .order("id")
          .range(offset, offset + 499),
      );
      all.push(...page);
      if (page.length < 500) break;
    }
    return all.sort((a, b) => a.name.localeCompare(b.name, "ja"));
  }
  async saveExercise(exercise: Exercise, create: boolean) {
    await this.owner();
    const payload = {
      name: exercise.name.trim(),
      record_type: exercise.record_type,
      archived_at: exercise.archived_at,
    };
    const query = create
      ? this.table("exercises").insert({
          id: exercise.id,
          user_id: this.userId,
          ...payload,
        })
      : this.table("exercises")
          .update(payload)
          .eq("id", exercise.id)
          .eq("user_id", this.userId);
    const { data, error } = await query.select("id");
    if (error)
      throw new Error(
        error.code === "23505"
          ? "同じ名前の種目が登録されています。"
          : error.code === "23503"
            ? "使用済み種目の記録タイプは変更できません。"
            : "種目の保存に失敗しました。通信状態を確認してください。",
      );
    if (data?.length !== 1) throw new Error("種目を保存できませんでした。");
  }
  async used(exerciseId: string) {
    await this.owner();
    const rows = await this.result(
      this.table("session_exercises")
        .select("id")
        .eq("user_id", this.userId)
        .eq("exercise_id", exerciseId)
        .limit(1),
    );
    return rows.length > 0;
  }
  async archive(exercise: Exercise) {
    await this.owner();
    const { error } = await this.client.rpc("archive_training_exercise", {
      p_id: exercise.id,
    });
    if (error)
      throw new Error(
        "種目を削除できません。進行中の使用状況と接続を確認してください。",
      );
  }
  async menus(): Promise<Menu[]> {
    await this.owner();
    const all = async (table: string) => {
      const rows: Record<string, unknown>[] = [];
      for (let offset = 0; ; offset += 500) {
        const page = await this.result(
          this.table(table)
            .select("*")
            .eq("user_id", this.userId)
            .order("id")
            .range(offset, offset + 499),
        );
        rows.push(...page);
        if (page.length < 500) return rows;
      }
    };
    const [menus, items] = await Promise.all([all("menus"), all("menu_items")]);
    return menus.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      items: items
        .filter((item) => item.menu_id === row.id)
        .sort((a, b) => Number(a.position) - Number(b.position))
        .map((item) => ({
          id: String(item.id),
          exerciseId: String(item.exercise_id),
          plannedSets: Number(item.planned_sets),
        })),
    }));
  }
  async saveMenu(menu: Menu, expected: Menu | null): Promise<Menu> {
    await this.owner();
    validateMenu(menu);
    const { data, error } = await this.client
      .rpc("save_training_menu", {
        p_id: menu.id,
        p_name: menu.name,
        p_items: menu.items,
        p_expected: expected,
      })
      .retry(false)
      .abortSignal(AbortSignal.timeout(20000));
    if (error)
      throw new Error(
        ["40001", "PT409"].includes(error.code)
          ? "メニューが更新されています。一覧を再読み込みして確認してください。"
          : "正式保存を確認できません。下書きを保持しています。接続を確認して再読み込みしてください。",
      );
    return data as Menu;
  }
  async deleteMenu(menu: Menu) {
    await this.owner();
    const rows = await this.result(
      this.table("menus")
        .delete()
        .eq("id", menu.id)
        .eq("user_id", this.userId)
        .select("id"),
    );
    if (rows.length !== 1)
      throw new Error("削除を確認できません。再読み込みしてください。");
  }
  async editHistory(workout: Workout) {
    await this.owner();
    if (!editableHistory(workout))
      throw new Error("同期済みの終了記録のみ編集できます。");
    validateHistory(workout);
    const { data, error } = await this.client.rpc("edit_training_history", {
      p_id: workout.id,
      p_revision: workout.revision,
      p_name: workout.name,
      p_ended_at: workout.endedAt,
      p_sections: workout.sections,
    });
    if (error)
      throw new Error(
        ["40001", "PT409"].includes(error.code)
          ? "履歴が更新されています。再読み込みして確認してください。"
          : "正式保存を確認できません。入力を保持しています。接続を確認して再読み込みしてください。",
      );
    return Number(data);
  }
  async deleteHistory(workout: Workout) {
    await this.owner();
    if (!editableHistory(workout))
      throw new Error("未同期の記録は削除できません。");
    const rows = await this.result(
      this.table("sessions")
        .delete()
        .eq("id", workout.id)
        .eq("user_id", this.userId)
        .eq("status", "completed")
        .eq("revision", workout.revision)
        .select("id"),
    );
    if (rows.length !== 1)
      throw new Error("削除を確認できません。履歴を再読み込みしてください。");
  }
  async workouts(): Promise<Workout[]> {
    await this.owner();
    // Explicit pagination avoids silently truncating previous records and PRs at PostgREST's row limit.
    const all = async (table: string, order: string) => {
      const rows: Record<string, unknown>[] = [];
      for (let offset = 0; ; offset += 500) {
        const page = await this.result(
          this.table(table)
            .select("*")
            .eq("user_id", this.userId)
            .order(order)
            .range(offset, offset + 499),
        );
        rows.push(...page);
        if (page.length < 500) return rows;
      }
    };
    const [sessions, sections, sets] = await Promise.all([
      all("sessions", "id"),
      all("session_exercises", "id"),
      all("workout_sets", "id"),
    ]);
    return sessions
      .map((row) => ({
        id: String(row.id),
        name: String(row.name),
        startedAt: String(row.started_at),
        endedAt: row.ended_at ? String(row.ended_at) : null,
        revision: Number(row.revision),
        syncedRevision: Number(row.revision),
        sections: sections
          .filter((s) => s.session_id === row.id)
          .sort((a, b) => Number(a.position) - Number(b.position))
          .map(
            (s) =>
              ({
                id: String(s.id),
                exerciseId: String(s.exercise_id),
                name: String(s.exercise_name_snapshot),
                type: s.record_type_snapshot as Section["type"],
                sets: sets
                  .filter((set) => set.session_exercise_id === s.id)
                  .sort((a, b) => Number(a.position) - Number(b.position))
                  .map(
                    (set) =>
                      ({
                        id: String(set.id),
                        weight:
                          set.weight_kg == null ? "" : String(set.weight_kg),
                        reps: set.reps == null ? "" : String(set.reps),
                        seconds:
                          set.duration_seconds == null
                            ? ""
                            : String(set.duration_seconds),
                        performed: Boolean(set.is_performed),
                        copied: Boolean(set.is_copied),
                      }) satisfies SetRecord,
                  ),
              }) satisfies Section,
          ),
      }))
      .map((w) => ({ ...w, syncBase: syncSnapshot(w) }));
  }
  async sync(workout: Workout) {
    await this.owner();
    // Legacy pending data without a known baseline may only reconcile an exact
    // server replay; it never authorizes creation of a missing server record.
    const expected = [
      ...(workout.syncBase
        ? [workout.syncBase]
        : workout.syncedRevision === 0
          ? [null]
          : []),
      ...(workout.syncAttempts ?? []),
    ];
    const { data, error } = await this.client
      .rpc("sync_training_session", {
        p_workout: syncSnapshot(workout),
        p_expected: expected,
      })
      .retry(false)
      .abortSignal(AbortSignal.timeout(20000));
    if (error) {
      if (["PT409", "23505"].includes(error.code))
        throw new SyncConflictError(
          "競合を検出したため同期を停止しました。端末データを保持しています。JSON出力でサーバーと端末の両方を確認してください。",
        );
      if (error.code === "PGRST202")
        throw new Error(
          "サーバーの同期準備が未完了です。端末保存を維持しています。",
        );
      throw new Error(
        "サーバー同期を確認できません。端末データを保持し、同じIDで再試行します。",
      );
    }
    if (Number(data) !== workout.revision)
      throw new Error(
        "同期成功応答の版を確認できません。端末データを保持しています。",
      );
  }
}
