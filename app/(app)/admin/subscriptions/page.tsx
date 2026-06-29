import { redirect } from "next/navigation";

export default function SubscriptionsRedirect() {
  redirect("/admin/customers");
}
