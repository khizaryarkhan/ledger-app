import { redirect } from "next/navigation";

// Resources workspace lands on the Resource Board (matching every other
// workspace's land-on-its-dashboard pattern).
export default function ResourcesHome() {
  redirect("/resources/board");
}
