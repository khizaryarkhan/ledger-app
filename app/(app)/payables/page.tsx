import { redirect } from "next/navigation";

// /payables on its own used to be a 404. The workspace home is its dashboard.
export default function PayablesIndex() {
  redirect("/payables/dashboard");
}
