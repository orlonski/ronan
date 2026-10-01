import type { Metadata, Viewport } from "next";
import { Providers } from "@/components/providers";
import { FundacaoApp } from "@/components/fundacao-app";
import { PwaRegister } from "@/components/pwa-register";
import { SCRIPT_MENU_INICIAL } from "@/lib/menu-preferencia";
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
  // Preview de quando alguém manda o link no WhatsApp. Sem isto, o link vai sem
  // cara nenhuma — ou, pior, com o ícone que sobrou no cache do aplicativo.
  openGraph: {
    title: "Movatruck",
    description: "Gestão de viagens, pedágios e abastecimentos.",
    images: ["/icon-512.png"],
    type: "website",
    locale: "pt_BR",
  },
};

export const viewport: Viewport = {
  // Cor da barra do navegador/app = fundo do painel (claro). Os temas escuros
  // são por classe (não por prefers-color-scheme), então a cor certa de cada
  // tema é acertada em runtime por <FundacaoApp/>.
  themeColor: "#ffffff",
  width: "device-width",
  initialScale: 1,
  // Zoom por pinça TRAVADO: o painel se comporta como app no celular (o zoom
  // acidental desalinhava a tela inteira). A contrapartida é de nossa conta:
  // campos com 16px e alvos de toque de 44px no celular (ui/), texto de apoio
  // sem ficar abaixo do mínimo de tamanho/contraste, e a pinça segue funcionando
  // onde ela é o ponto (mapas e visualizador de foto, com gesto próprio).
  // Limitação: o Safari do iOS ignora `user-scalable=no` desde o iOS 10; o
  // reforço está em <FundacaoApp/> (gesturestart, só no app instalado).
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  // Teclado de Android encolhe a área da página (o botão fixo sobe junto).
  interactiveWidget: "resizes-content",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        {/* Preferência do menu lateral (`data-menu` no <html>) ANTES da primeira pintura: o CSS
            decide menu fixo x gaveta sem piscar e sem ler a largura da janela no render. */}
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_MENU_INICIAL }} />
      </head>
      <body className="min-h-dvh antialiased">
        <Providers>{children}</Providers>
        <PwaRegister />
        <FundacaoApp />
      </body>
    </html>
  );
}
