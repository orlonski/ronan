import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Movatruck — Painel",
    short_name: "Movatruck",
    description: "Painel de gestão de viagens e logística",
    id: "/",
    scope: "/",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    lang: "pt-BR",
    // Celular pode girar: tabela e mapa pedem paisagem.
    orientation: "any",
    // Só rotas que existem (as mesmas da barra inferior). Quem não tem a
    // permissão cai na tela de acesso restrito, sem vazar dado.
    shortcuts: [
      { name: "Viagens", url: "/viagens", icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }] },
      { name: "Motoristas", url: "/motoristas", icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }] },
      { name: "Ao vivo", url: "/viagens-andamento", icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }] },
    ],
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        // Próprio, com a marca dentro da zona segura (10% de margem) e fundo cheio:
        // o "any" tem cantos brancos e o Android cortava o logo.
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
