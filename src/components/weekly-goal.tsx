"use client";
import { useState } from "react";
import { useTraining } from "./training-context";
import { useGoals, useAnalysisClock } from "./goals-context";
import { nextMonday, weeklyProgress } from "@/lib/analytics/model";
export function WeeklyGoal({ compact = false }: { compact?: boolean }) {
  const { workouts } = useTraining();
  const { goals, loaded, online, message, reload, save } = useGoals();
  const { now, timeZone } = useAnalysisClock();
  const progress = weeklyProgress(workouts, goals, now, timeZone);
  const next = nextMonday(now, timeZone),
    scheduled = goals.find((g) => g.effective_monday === next);
  const [target, setTarget] = useState("3"),
    [editing, setEditing] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <section className="panel" aria-label="週間目標">
      <h2>今週の週間目標</h2>
      {!loaded ? (
        <p>目標を確認できていません。</p>
      ) : (
        <>
          <p>
            {progress.target === undefined
              ? "未設定（達成率・連続達成週数は未定義）"
              : `${progress.days}日 / ${progress.target}日・達成率 ${Math.round(progress.rate!)}%・連続 ${progress.streak}週`}
          </p>
          <p className="muted small">
            {progress.week}からの月曜始まり。完了・同期済みの実施日だけを集計。
          </p>
          <p>
            {next}からの目標：
            {scheduled ? `${scheduled.target_days}日` : "変更予定なし"}
          </p>
        </>
      )}
      {!online && <p className="muted">保存済み表示・サーバー未確認</p>}
      {message && <p role="status">{message}</p>}
      <div className="button-row">
        <button
          disabled={busy || !loaded}
          onClick={() => {
            setTarget(String(scheduled?.target_days ?? progress.target ?? 3));
            setEditing(!editing);
            setError("");
          }}
        >
          週間目標を変更
        </button>
        <button disabled={busy} onClick={() => void reload()}>
          目標を再読み込み
        </button>
      </div>
      {editing && (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError("");
            try {
              await save(Number(target), timeZone);
              setEditing(false);
            } catch (e) {
              setError(
                e instanceof Error ? e.message : "保存できませんでした。",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <p>
            変更は次の月曜日から適用します。今週・過去週の目標は変わりません。
          </p>
          <label>
            週間目標日数
            <select
              aria-label="週間目標日数"
              value={target}
              disabled={busy}
              onChange={(e) => setTarget(e.target.value)}
            >
              {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                <option key={n} value={n}>
                  {n}日
                </option>
              ))}
            </select>
          </label>
          {error && <p role="alert">{error}</p>}
          <div className="button-row">
            <button
              className="primary"
              disabled={busy || !loaded}
              type="submit"
            >
              {busy ? "保存中" : "来週の目標を保存"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setEditing(false)}
            >
              キャンセル
            </button>
          </div>
        </form>
      )}
      {!compact && loaded && (
        <details>
          <summary>目標の適用履歴</summary>
          {goals.length ? (
            <ul>
              {[...goals]
                .sort((a, b) =>
                  b.effective_monday.localeCompare(a.effective_monday),
                )
                .map((g) => (
                  <li key={g.id}>
                    {g.effective_monday}から {g.target_days}日
                  </li>
                ))}
            </ul>
          ) : (
            <p>目標履歴はありません。</p>
          )}
        </details>
      )}
    </section>
  );
}
