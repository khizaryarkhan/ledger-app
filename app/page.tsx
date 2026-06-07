import { redirect } from "next/navigation";

// Root "/" — middleware handles auth:
//   • Logged-in users  → /dashboard
//   • Guests           → /login
// This component is a fallback that should rarely execute.
export default function RootPage() {
  redirect("/dashboard");
}
