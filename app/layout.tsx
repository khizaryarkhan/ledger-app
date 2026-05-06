import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Ledger — Collections CRM",
  description: "Accounts receivable collections workflow",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
