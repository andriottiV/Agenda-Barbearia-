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
  applicationName: "HoraAi",
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "https://horaai.app"),
  title: {
    default: "HoraAi",
    template: "%s | HoraAi",
  },
  description: "Sua agenda online e rápida",
  icons: {
    apple: [
      { url: "/apple-icon.png?v=3", sizes: "180x180", type: "image/png" },
      { url: "/apple-touch-icon.png?v=3", sizes: "180x180", type: "image/png" },
    ],
    icon: [
      { url: "/favicon.ico?v=3", sizes: "any" },
      { url: "/favicon-16x16.png?v=3", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png?v=3", sizes: "32x32", type: "image/png" },
      { url: "/icon-192.png?v=3", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png?v=3", sizes: "512x512", type: "image/png" },
    ],
    shortcut: ["/favicon.ico?v=3", "/icon-192.png?v=3"],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "HoraAi",
  },
  openGraph: {
    title: "HoraAi",
    description: "Sua agenda online e rápida",
    images: [
      {
        url: "/HoraAi-AppIconAB.png?v=3",
        width: 512,
        height: 512,
        alt: "HoraAi",
      },
    ],
    siteName: "HoraAi",
    type: "website",
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
