import { SolutionPage } from "@/components/solution-page";
import { buildSolutionMetadata } from "@/lib/marketing-data";

const SLUG = "customer-payment-portal";
export const metadata = buildSolutionMetadata(SLUG);

export default function Page() {
  return <SolutionPage slug={SLUG} />;
}
