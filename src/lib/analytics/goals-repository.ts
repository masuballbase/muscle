import type { SupabaseClient } from "@supabase/supabase-js";
import { type Goal, nextMonday } from "./model";
export class GoalsRepository {
  constructor(
    private client: SupabaseClient,
    readonly userId: string,
  ) {}
  private async owner() {
    const { data, error } = await this.client.auth.getSession();
    if (error || data.session?.user.id !== this.userId)
      throw new Error("ログイン状態を確認してください。");
  }
  async list(): Promise<Goal[]> {
    await this.owner();
    const rows: Goal[] = [];
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await this.client
        .from("weekly_goal_schedule")
        .select("id,effective_monday,target_days")
        .eq("user_id", this.userId)
        .order("effective_monday")
        .range(offset, offset + 499);
      if (error)
        throw new Error(
          "週間目標を読み込めません。保存済みの表示を保持しています。",
        );
      rows.push(...(data ?? []));
      if ((data?.length ?? 0) < 500) return rows;
    }
  }
  async save(
    target: number,
    timeZone: string,
    now = new Date(),
  ): Promise<Goal> {
    await this.owner();
    if (!Number.isInteger(target) || target < 1 || target > 7)
      throw new Error("目標は1〜7日で設定してください。");
    const effective = nextMonday(now, timeZone);
    // The deployed table has no default for id. Preserve existing IDs and
    // issue one atomic row write; a concurrent create is rejected by uniqueness.
    const existing = await this.client
      .from("weekly_goal_schedule")
      .select("id")
      .eq("user_id", this.userId)
      .eq("effective_monday", effective)
      .maybeSingle();
    if (existing.error)
      throw new Error("目標を確認できません。再読み込みしてください。");
    await this.owner();
    const query = existing.data
      ? this.client
          .from("weekly_goal_schedule")
          .update({ target_days: target })
          .eq("id", existing.data.id)
          .eq("user_id", this.userId)
          .eq("effective_monday", effective)
      : this.client.from("weekly_goal_schedule").insert({
          id: crypto.randomUUID(),
          user_id: this.userId,
          effective_monday: effective,
          target_days: target,
        });
    const { data, error } = await query.select(
      "id,effective_monday,target_days",
    );
    if (error || data?.length !== 1)
      throw new Error(
        "目標の正式保存を確認できません。接続を確認して再読み込みしてください。",
      );
    return data[0];
  }
}
