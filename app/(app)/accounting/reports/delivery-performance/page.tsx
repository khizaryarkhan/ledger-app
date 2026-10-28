import { Suspense } from "react";
import { DeliveryPerformanceReport } from "@/components/delivery-performance-report";

export default function DeliveryPerformancePage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-stone-500">Loading…</div>}>
      <DeliveryPerformanceReport />
    </Suspense>
  );
}
