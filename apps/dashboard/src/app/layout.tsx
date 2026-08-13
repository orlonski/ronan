import type { Metadata, Viewport } from "next";
import { Providers } from "@/components/providers";
import { PwaRegister } from "@/components/pwa-register";
import "./globals.css";

export const metadata: Metadata = {
  title: "Movatruck — Painel",
  description: "Painel de gestão de viagens e logística",
  applicationName: "Movatruck",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Movatruck",
  },
  icons: {
    icon: "/icon-512.png",
    apple: "/apple-icon-180.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#3b82f6",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body className="min-h-screen antialiased">
        <Providers>{children}</Providers>
        <PwaRegister />
      </body>
    </html>
  );
}
