import { Suspense } from "react";
import { CreditsAdjustmentsReport } from "@/components/credits-adjustments-report";

export default function CreditsAdjustmentsPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-stone-500">Loading…</div>}>
      <CreditsAdjustmentsReport />
    </Suspense>
  );
}
