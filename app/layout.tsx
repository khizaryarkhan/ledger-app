import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Foodready Collection Manager",
  description: "Accounts receivable collection workflow by Foodready",
  icons: {
    icon: "https://app.foodready.ai/app/assets/foodready_logo.AOW0PckZ.svg",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
