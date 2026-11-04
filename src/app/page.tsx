import { TrainingHome } from "@/components/training-home";
// The protected UI is revealed only after client-side auth/session restoration.
// Next 16.4 cannot validate instant rendering of that initially hidden segment.
export const instant = false;
export default function Page() {
  return <TrainingHome />;
}
