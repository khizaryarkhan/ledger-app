import { AlternativePage } from "@/components/alternative-page";
import { buildAlternativeMetadata } from "@/lib/competitors-data";

const SLUG = "chaser-alternative";
export const metadata = buildAlternativeMetadata(SLUG);

export default function Page() {
  return <AlternativePage slug={SLUG} />;
}
