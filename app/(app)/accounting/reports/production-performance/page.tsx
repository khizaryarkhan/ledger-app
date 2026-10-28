import { Suspense } from "react";
import { ProductionPerformanceReport } from "@/components/production-performance-report";

export default function ProductionPerformancePage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-stone-500">Loading…</div>}>
      <ProductionPerformanceReport />
    </Suspense>
  );
}
