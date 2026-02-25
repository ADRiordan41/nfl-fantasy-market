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
  manifest: "/manifest.webmanifest",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${aleo.variable} antialiased`}>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
