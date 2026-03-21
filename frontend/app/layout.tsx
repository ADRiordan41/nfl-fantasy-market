import type { Metadata } from "next";
import { Aleo } from "next/font/google";
import AppShell from "@/components/app-shell";
import "./globals.css";

const aleo = Aleo({
  subsets: ["latin"],
  variable: "--font-brand-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "MatchupMarket",
  description: "Trade and track fantasy player shares with live quote previews.",
  icons: {
    icon: [
      { url: "/favicon.ico?v=current-logo", sizes: "any" },
      { url: "/icon.svg?v=current-logo", type: "image/svg+xml" },
    ],
    shortcut: "/favicon.ico?v=current-logo",
    apple: "/icon.svg?v=current-logo",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${aleo.variable} antialiased`}>
        <a href="#main-content" className="skip-link">
          Skip to content
        </a>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
