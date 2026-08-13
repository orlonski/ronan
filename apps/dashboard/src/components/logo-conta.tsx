"use client";

import { MovatruckLogo } from "@/components/movatruck-logo";
import { useMarcaConta } from "@/lib/marca-conta";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

/**
 * A marca que aparece DENTRO do painel: a logo da empresa logada, caindo na
 * marca da plataforma quando ela ainda não enviou uma.
 *
 * O cuidado aqui é com o primeiro instante depois de um F5. A empresa só é
 * conhecida quando `/admin/users/me` responde, e até lá renderizar a marca da
 * plataforma fazia o cliente ver, por um segundo, o logo de outro produto no
 * painel dele. Então: usa a última marca conhecida (localStorage) pra já
 * desenhar certo, e enquanto não houver nenhuma, reserva o espaço em vez de
 * chutar. Piscar a marca errada é pior que aparecer um pouco depois.
 *
 * Não serve pra tela de login — lá ainda não se sabe de quem é a pessoa, e a
 * porta de entrada é a marca da plataforma de propósito.
 */
export function LogoConta({
  width = 160,
  className,
}: {
  width?: number;
  className?: string;
}) {
  const { marca: atual, carregando } = useMarcaConta();

  // Primeiro acesso neste navegador: segura o espaço em vez de chutar. Acontece
  // uma vez só — depois a marca fica lembrada.
  if (carregando) {
    return <span style={{ width, height: Math.round(width / 2.2) }} className={className} />;
  }

  if (atual?.logoUrl) {
    return (
      // A URL carrega um `v` que muda a cada troca, então o cache do navegador
      // não segura a logo antiga. <img> cru em vez de next/image porque a origem
      // é a API (host variável por ambiente) e não vale configurar remotePatterns
      // pra uma imagem só.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`${API_URL}${atual.logoUrl}`}
        alt={atual.nome}
        style={{ width, maxHeight: Math.round(width / 2.2), objectFit: "contain" }}
        className={className}
      />
    );
  }

  return <MovatruckLogo width={width} className={className} />;
}
