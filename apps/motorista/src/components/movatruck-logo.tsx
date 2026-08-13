/**
 * A marca da plataforma, pro fundo azul-marinho das telas de entrada.
 *
 * Só a arte de fundo escuro mora aqui: o único lugar que usa logo no PWA é o
 * hero `bg-brand`, que é marinho sempre. A arte clara tem "Mova" em azul-marinho
 * e sumiria ali. Precisando dela numa tela branca, copie a outra do painel em vez
 * de tingir esta — o logo é policromático (o "truck" é laranja) e pintar tudo de
 * uma cor só destrói a marca.
 *
 * Espelha `movatruck-logo.tsx` do app nativo, que faz o mesmo com `SvgXml`.
 */

const ASPECTO = 1795 / 390;

export function MovatruckLogo({ width = 210 }: { width?: number }) {
  return (
    <img
      src="/marca/movatruck-logo-fundo-escuro.svg"
      alt="Movatruck"
      width={width}
      height={Math.round(width / ASPECTO)}
      style={{ width, height: Math.round(width / ASPECTO) }}
    />
  );
}
