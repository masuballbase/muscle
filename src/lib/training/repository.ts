import { type Menu, validateMenu } from "../menus/model";
import { validateHistory, editableHistory } from "../history/model";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  type Exercise,
  type Workout,
  type Section,
  type SetRecord,
  validSet,
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
    const { data, error } = await query;
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
    const { data, error } = await this.client.rpc("save_training_menu", {
      p_id: menu.id,
      p_name: menu.name,
      p_items: menu.items,
      p_expected: expected,
    });
    if (error)
      throw new Error(
        error.code === "40001"
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
        error.code === "40001"
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
    return sessions.map((row) => ({
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
    }));
  }
  async sync(workout: Workout) {
    await this.owner();
    const owner = { user_id: this.userId };
    const remote = await this.result(
      this.table("sessions")
        .select("id,status,revision")
        .eq("user_id", this.userId)
        .eq("id", workout.id),
    );
    if (remote[0]?.status === "completed") {
      if (!workout.endedAt)
        throw new Error("サーバーで終了済みです。再読み込みしてください。");
      if (Number(remote[0].revision) !== workout.revision)
        throw new Error(
          "サーバーの記録と版が一致しません。端末の記録を保持しています。",
        );
      return;
    }
    if (!remote.length) {
      await this.result(
        this.table("sessions").insert({
          id: workout.id,
          ...owner,
          name: workout.name,
          started_at: workout.startedAt,
          status: "active",
          ended_at: null,
          revision: workout.revision,
        }),
      );
    }
    // Delete tombstones and temporarily move positions to avoid unique-position conflicts on retries.
    const remoteSections = await this.result(
      this.table("session_exercises")
        .select("id,position")
        .eq("user_id", this.userId)
        .eq("session_id", workout.id),
    );
    const sectionIds = remoteSections.map((s) => s.id);
    if (sectionIds.length) {
      const remoteSets = await this.result(
        this.table("workout_sets")
          .select("id,position")
          .eq("user_id", this.userId)
          .in("session_exercise_id", sectionIds),
      );
      const retained = new Set(
        workout.sections.flatMap((s) => s.sets.map((set) => set.id)),
      );
      for (const set of remoteSets)
        if (!retained.has(set.id))
          await this.result(
            this.table("workout_sets")
              .delete()
              .eq("user_id", this.userId)
              .eq("id", set.id),
          );
      const base =
        Math.max(
          0,
          ...remoteSets.map((set) => Number(set.position)),
          ...workout.sections.map((s) => s.sets.length),
        ) + 1000;
      for (const [index, set] of remoteSets.entries())
        if (retained.has(set.id))
          await this.result(
            this.table("workout_sets")
              .update({ position: base + index })
              .eq("user_id", this.userId)
              .eq("id", set.id),
          );
    }
    const sectionBase =
      Math.max(
        0,
        ...remoteSections.map((s) => Number(s.position)),
        workout.sections.length,
      ) + 1000;
    for (const [index, s] of remoteSections.entries()) {
      if (!workout.sections.some((local) => local.id === s.id))
        await this.result(
          this.table("session_exercises")
            .delete()
            .eq("user_id", this.userId)
            .eq("id", s.id),
        );
      else
        await this.result(
          this.table("session_exercises")
            .update({ position: sectionBase + index })
            .eq("user_id", this.userId)
            .eq("id", s.id),
        );
    }
    for (const [position, section] of workout.sections.entries()) {
      await this.owner();
      await this.result(
        this.table("session_exercises").upsert({
          id: section.id,
          ...owner,
          session_id: workout.id,
          exercise_id: section.exerciseId,
          exercise_name_snapshot: section.name,
          record_type_snapshot: section.type,
          position,
        }),
      );
      if (section.sets.length)
        await this.result(
          this.table("workout_sets").upsert(
            section.sets.map((set, position) => ({
              id: set.id,
              ...owner,
              session_exercise_id: section.id,
              record_type: section.type,
              position,
              weight_kg:
                section.type === "weight_reps" &&
                /^\d+(\.\d+)?$/.test(set.weight)
                  ? Number(set.weight)
                  : null,
              reps:
                section.type !== "duration" &&
                /^\d+$/.test(set.reps) &&
                Number(set.reps) >= 1
                  ? Number(set.reps)
                  : null,
              duration_seconds:
                section.type === "duration" &&
                /^\d+$/.test(set.seconds) &&
                Number(set.seconds) >= 1
                  ? Number(set.seconds)
                  : null,
              is_performed: set.performed && validSet(set, section.type),
              is_copied: set.copied,
            })),
          ),
        );
    }
    await this.owner();
    // Completion is published only after every child write succeeds.
    const published = await this.result(
      this.table("sessions")
        .update({
          name: workout.name,
          status: workout.endedAt ? "completed" : "active",
          ended_at: workout.endedAt,
          revision: workout.revision,
        })
        .eq("user_id", this.userId)
        .eq("id", workout.id)
        .select("id"),
    );
    if (published.length !== 1)
      throw new Error(
        "同期の確定を確認できません。端末の記録を保持しています。",
      );
  }
}
