import { SolutionPage } from "@/components/solution-page";
import { buildSolutionMetadata } from "@/lib/marketing-data";

const SLUG = "accounts-receivable-software-for-xero";
export const metadata = buildSolutionMetadata(SLUG);

export default function Page() {
  return <SolutionPage slug={SLUG} />;
}
