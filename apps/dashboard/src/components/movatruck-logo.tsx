import { cn } from "@/lib/utils";

/**
 * A marca da plataforma.
 *
 * Duas artes em vez de uma que muda de cor: no logo claro a palavra "Mova" é
 * azul-marinho, que some em fundo escuro. A versão de fundo escuro traz ela em
 * branco. Truque de `currentColor` não serve aqui — o logo é policromático (o
 * "truck" é laranja nas duas), e tingir tudo de uma cor só destruiria a marca.
 *
 * `forcarClaro` é pro fundo que é escuro sempre, independente do tema — o vídeo
 * da tela de login, por exemplo.
 */
export function MovatruckLogo({
  width = 180,
  className,
  forcarClaro = false,
}: {
  width?: number;
  className?: string;
  /** Usa a arte de fundo escuro sem olhar o tema. */
  forcarClaro?: boolean;
}) {
  const aspectRatio = 1795 / 390;
  const height = Math.round(width / aspectRatio);
  const estilo = { width, height };

  if (forcarClaro) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src="/marca/movatruck-logo-fundo-escuro.svg"
        alt="Movatruck"
        style={estilo}
        className={className}
      />
    );
  }

  return (
    <span className={cn("inline-block", className)} style={estilo}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/marca/movatruck-logo.svg"
        alt="Movatruck"
        style={estilo}
        className="block dark:hidden"
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/marca/movatruck-logo-fundo-escuro.svg"
        alt="Movatruck"
        style={estilo}
        className="hidden dark:block"
      />
    </span>
  );
}
