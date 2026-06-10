import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Collection Manager",
  description: "Accounts receivable collection workflow",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/*
          Defensive cleanup: this app does not use a service worker. If any
          visitor still has an orphaned SW from a previous site on this domain,
          unregister it and clear its caches the moment they load real app HTML.
          (Devices stuck on the orphan's cached 404 are healed by /sw.js instead.)
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                navigator.serviceWorker.getRegistrations()
                  .then(function (rs) { rs.forEach(function (r) { r.unregister(); }); })
                  .catch(function () {});
                if (window.caches && caches.keys) {
                  caches.keys()
                    .then(function (ks) { ks.forEach(function (k) { caches.delete(k); }); })
                    .catch(function () {});
                }
              }
            `,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
