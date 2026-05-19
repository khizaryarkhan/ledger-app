"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Email / SMTP configuration has moved to Settings → Integrations.
 * Redirect any direct links to the new location.
 */
export default function NotificationsRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/settings/integrations");
  }, [router]);
  return null;
}
