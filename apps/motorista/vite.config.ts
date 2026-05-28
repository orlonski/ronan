import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      includeAssets: ["favicon.ico", "robots.txt", "icon-192.png", "icon-512.png"],
      manifest: {
        name: "Schaba — Motorista",
        short_name: "Schaba",
        description: "App do motorista da Schaba. Lança viagens, pedágios e abastecimentos com suporte offline.",
        theme_color: "#13316b",
        background_color: "#13316b",
        display: "standalone",
        orientation: "portrait",
        lang: "pt-BR",
        start_url: "/",
        scope: "/",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
        categories: ["business", "productivity"],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico}"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/m\//],
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.destination === "image",
            handler: "CacheFirst",
            options: { cacheName: "imgs", expiration: { maxEntries: 128, maxAgeSeconds: 60 * 60 * 24 * 30 } },
          },
          {
            // GETs no /m/* (catalogos, viagens, resumo) — tenta rede, cai pro cache se offline
            urlPattern: ({ url, request }) => url.pathname.startsWith("/m/") && request.method === "GET",
            handler: "NetworkFirst",
            options: {
              cacheName: "api-m",
              networkTimeoutSeconds: 8,
              expiration: { maxEntries: 64, maxAgeSeconds: 60 * 60 * 24 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: { enabled: false, type: "module" },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Aponta direto pro src TS do shared-types — evita CJS->ESM dance e o build
      // do dashboard (Next) continua usando o dist/ via package.main.
      "@ronan/shared-types": path.resolve(__dirname, "../../packages/shared-types/src/index.ts"),
    },
  },
  server: { port: 3002, host: true },
  optimizeDeps: {
    // shared-types é CJS (output do tsc com module: commonjs). Pré-bundle pro
    // Rollup conseguir resolver named exports estaticamente.
    include: ["@ronan/shared-types"],
  },
  build: {
    target: "es2020",
    sourcemap: false,
    commonjsOptions: {
      transformMixedEsModules: true,
    },
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          query: ["@tanstack/react-query"],
          // Leaflet só carrega na tela de detalhe da viagem, mantém em chunk próprio
          leaflet: ["leaflet", "react-leaflet"],
        },
      },
    },
  },
});
