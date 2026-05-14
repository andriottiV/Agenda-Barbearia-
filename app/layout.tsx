import type { Metadata, Viewport } from "next";
import { Barlow_Condensed, Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const barlowCondensed = Barlow_Condensed({
  variable: "--font-barlow-condensed",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const fontVariables = `${inter.variable} ${barlowCondensed.variable}`;

export const metadata: Metadata = {
  title: {
    default: "HoraAi",
    template: "%s | HoraAi",
  },
  description: "Sua agenda online e rápida",
  icons: {
    apple: [{ url: "/IconAB.png?v=20260514", sizes: "180x180", type: "image/png" }],
    icon: [{ url: "/IconAB.png?v=20260514", sizes: "512x512", type: "image/png" }],
    shortcut: ["/IconAB.png?v=20260514"],
  },
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: "#D4AF37",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-BR"
      className={`${fontVariables} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
