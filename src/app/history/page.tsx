import { PendingWorkouts } from "@/components/pending-workouts";
import { PhasePanel } from "@/components/phase-panel";
export default function Page() {
  return (
    <>
      <PhasePanel
        title="履歴"
        subtitle="これまでのトレーニングを振り返る。"
        items={[
          "月間カレンダー",
          "選択日のセッション・直近の履歴",
          "記録の詳細・編集",
        ]}
      />
      <PendingWorkouts />
    </>
  );
}
