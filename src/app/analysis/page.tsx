import { PhasePanel } from "@/components/phase-panel";
export default function Page() {
  return (
    <PhasePanel
      title="分析"
      subtitle="続けた成果を、少しずつ確かめる。"
      items={[
        "5つの指標とトレーニング頻度",
        "種目別の実施頻度ランキング",
        "PR・種目別の成長グラフ",
      ]}
    />
  );
}
