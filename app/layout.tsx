import "./globals.css";
import type { Metadata } from "next";

const SITE_URL = "https://primeaccountax.com";

const DESCRIPTION =
  "Prime Accountax is an accounts receivable (AR) management and collections platform for QuickBooks Online and Xero. Automatically sync invoices and customers, send branded payment reminders, track promises and disputes, and get paid faster — reducing DSO without manual chasing.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Prime Accountax — AR Management & Collections Software for QuickBooks Online",
    template: "%s · Prime Accountax",
  },
  description: DESCRIPTION,
  applicationName: "Prime Accountax",
  authors: [{ name: "Prime Accountax" }],
  creator: "Prime Accountax",
  publisher: "Prime Accountax",
  category: "Business Software",
  keywords: [
    "accounts receivable software for QuickBooks",
    "AR management tool for QuickBooks Online",
    "QuickBooks collections software",
    "QuickBooks Online accounts receivable automation",
    "automate invoice reminders QuickBooks",
    "accounts receivable management software",
    "invoice collections software",
    "dunning software QuickBooks",
    "reduce DSO QuickBooks",
    "Xero accounts receivable software",
    "QBO AR automation",
    "get invoices paid faster",
    "collections CRM for accountants",
  ],
  alternates: { canonical: SITE_URL },
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: "Prime Accountax",
    title: "AR Management & Collections Software for QuickBooks Online & Xero",
    description: DESCRIPTION,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "Prime Accountax — AR Collections for QuickBooks & Xero",
    description: DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  // To verify in Google Search Console, paste your token here:
  // verification: { google: "YOUR_GOOGLE_SITE_VERIFICATION_TOKEN" },
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
