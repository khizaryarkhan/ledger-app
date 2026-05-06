import { bad, ok } from "@/lib/api";

export async function POST() {
  return bad("Registration is invite-only. Please contact your administrator.", 403);
}
