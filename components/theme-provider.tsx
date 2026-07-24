"use client";

/**
 * App theme switching — Dark (default) / Light / System.
 *
 * The wrapper div carries [data-theme], which the CSS variables in
 * globals.css key off. It uses `display: contents` so it is invisible to
 * layout, and it deliberately wraps ONLY the app shell — the marketing /
 * landing pages are light-first with their own literal colors and must
 * never inherit an app theme.
 *
 * Preference is stored in localStorage. SSR always renders "dark" (the
 * default); the client initializer reads storage synchronously so the very
 * first client render is already correct — suppressHydrationWarning covers
 * the one attribute that can differ between the two.
 */

import { createContext, useContext, useEffect, useState, ReactNode } from "react";

export type ThemePref = "dark" | "light" | "system";
const STORAGE_KEY = "pa-theme";

function readStored(): ThemePref {
  if (typeof window === "undefined") return "dark";
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "light" || v === "system" ? v : "dark";
  } catch { return "dark"; }
}

function resolve(pref: ThemePref): "dark" | "light" {
  if (pref !== "system") return pref;
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

const ThemeContext = createContext<{
  pref: ThemePref;
  resolved: "dark" | "light";
  setPref: (p: ThemePref) => void;
}>({ pref: "dark", resolved: "dark", setPref: () => {} });

export const useTheme = () => useContext(ThemeContext);

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Start at the SSR default ("dark") so server and first client render match.
  // The saved preference is loaded in a mount effect below — this forces a
  // real re-render that PATCHES data-theme (previously suppressHydrationWarning
  // made React skip that patch, so a saved "light" never took and it always
  // reverted to dark).
  const [pref, setPrefState] = useState<ThemePref>("dark");
  const [resolved, setResolved] = useState<"dark" | "light">("dark");

  // Load the saved preference once, on the client, after mount.
  useEffect(() => { setPrefState(readStored()); }, []);

  // Resolve whenever the preference changes, and track the OS in System mode.
  useEffect(() => {
    setResolved(resolve(pref));
    if (pref !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => setResolved(resolve("system"));
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [pref]);

  const setPref = (p: ThemePref) => {
    setPrefState(p);
    try { localStorage.setItem(STORAGE_KEY, p); } catch {}
  };

  return (
    <ThemeContext.Provider value={{ pref, resolved, setPref }}>
      <div data-theme={resolved} suppressHydrationWarning className="contents">
        {children}
      </div>
    </ThemeContext.Provider>
  );
}
