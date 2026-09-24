import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // monorepo: rastreia deps a partir da raiz do workspace
  outputFileTracingRoot: path.join(__dirname, "../.."),
  experimental: {
    typedRoutes: true,
    // O repasse da leitura (rewrites abaixo) corta em 30s por padrão; relatório
    // grande pode passar disso.
    proxyTimeout: 120_000,
  },
  transpilePackages: ["@ronan/shared-types"],
  /**
   * Leitura da API pela própria origem do painel — ver `urlDaApi` em
   * `lib/client-api.ts` (evita o OPTIONS por URL que o navegador faz em
   * chamada autenticada pra outra origem). A URL entra no build, igual à
   * `NEXT_PUBLIC_API_URL` que o navegador já usava.
   */
  async rewrites() {
    const api = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";
    return [{ source: "/api-proxy/:path*", destination: `${api}/:path*` }];
  },
  async redirects() {
    return [
      {
        // O template `compartilhamento_viagem` foi aprovado na Meta com o botão
        // apontando pra `/c/<token>`, prefixo que nunca existiu aqui — só
        // `/v/<token>`. Enquanto o template não for corrigido lá, e mesmo
        // depois (os links já enviados continuam circulando no WhatsApp do
        // cliente), esse redirect é o que salva o comprovante do 404.
        // 307 e não 308 de propósito: o dia que `/c/` for outra coisa, browser
        // nenhum estará com o desvio cacheado.
        source: "/c/:token",
        destination: "/v/:token",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
