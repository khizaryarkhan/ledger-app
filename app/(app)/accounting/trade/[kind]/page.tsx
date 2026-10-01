import { redirect } from "next/navigation";
import { TradeDocList } from "@/components/trade-doc-list";

const KINDS = ["estimates", "purchase-orders", "sales-orders"] as const;

export default function TradeDocsPage({ params }: { params: { kind: string } }) {
  if (!(KINDS as readonly string[]).includes(params.kind)) redirect("/accounting/trade/estimates");
  // Keyed on `kind`: the three routes share one TradeDocList instance across
  // client-side navigation (same dynamic segment, only the param changes), so
  // without a key the ListView's per-screen filter/sort state (persisted under
  // a `kind`-scoped storage key) would carry over in memory from whichever
  // kind was viewed previously, until the next filter change overwrote it.
  return <TradeDocList key={params.kind} kind={params.kind as (typeof KINDS)[number]} />;
}
