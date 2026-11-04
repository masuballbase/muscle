"use client";
import { useTraining } from "./training-context";
export function PendingWorkouts() {
  const { workouts } = useTraining();
  const pending = workouts.filter(
    (w) => w.endedAt && w.syncedRevision < w.revision,
  );
  if (!pending.length) return null;
  return (
    <section className="panel" aria-label="未同期の終了済みトレーニング">
      <h2>終了済み・未同期</h2>
      <p className="muted small">
        記録は端末に保存されています。同期後に正式な実績へ反映します。
      </p>
      <ul>
        {pending.map((w) => (
          <li key={w.id}>
            {w.name} · 終了 {new Date(w.endedAt!).toLocaleString("ja-JP")}
          </li>
        ))}
      </ul>
    </section>
  );
}
