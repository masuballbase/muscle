import { PhasePanel } from "@/components/phase-panel";
export default function Page() {
  return (
    <PhasePanel
      title="InBody"
      subtitle="からだの変化を記録する。"
      items={["最新の4指標", "指標別の推移グラフ", "CSV取込・測定履歴"]}
    />
  );
}
