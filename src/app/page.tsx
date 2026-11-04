import { PhasePanel } from "@/components/phase-panel";
export default function Page() {
  return (
    <PhasePanel
      title="記録"
      subtitle="今日の積み重ねは、ここから。"
      items={[
        "自由に開始・メニューから開始",
        "トレーニングの再開",
        "メニュー管理・種目管理",
      ]}
    />
  );
}
