"use client";

import { MovatruckLogo } from "@/components/movatruck-logo";
import { usePermissoes } from "@/lib/permissoes";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

/**
 * A marca que aparece DENTRO do painel: a logo da empresa logada, caindo na
 * marca da plataforma quando ela ainda não enviou uma.
 *
 * Não serve pra tela de login — lá ainda não se sabe de qual empresa é a pessoa,
 * e a porta de entrada é a marca da plataforma de propósito.
 */
export function LogoConta({
  width = 160,
  className,
}: {
  width?: number;
  className?: string;
}) {
  const { conta } = usePermissoes();

  if (conta?.logoUrl) {
    return (
      // A URL carrega um `v` que muda a cada troca, então o cache do navegador
      // não segura a logo antiga. <img> cru em vez de next/image porque a origem
      // é a API (host variável por ambiente) e não vale configurar remotePatterns
      // pra uma imagem só.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`${API_URL}${conta.logoUrl}`}
        alt={conta.nome}
        style={{ width, maxHeight: Math.round(width / 2.2), objectFit: "contain" }}
        className={className}
      />
    );
  }

  return <MovatruckLogo width={width} className={className} />;
}
