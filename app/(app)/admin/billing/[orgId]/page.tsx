import { redirect } from "next/navigation";

// The per-org billing record now lives under /admin/customers/[orgId]
// (customer-centric, with Invoices / Payments / Credit Notes tabs).
export default function LegacyOrgBillingRedirect({ params }: { params: { orgId: string } }) {
  redirect(`/admin/customers/${params.orgId}`);
}
