import { LinkIcon } from "lucide-react";

const TEXTOS = {
  LINK_EXPIRADO: {
    titulo: "Este link expirou",
    corpo: "Peça um comprovante novo para quem te mandou o link — leva um minuto pra gerar.",
  },
  LINK_REVOGADO: {
    titulo: "Este link foi desativado",
    corpo: "Peça um comprovante novo para quem te mandou o link.",
  },
  LINK_INVALIDO: {
    titulo: "Link não encontrado",
    corpo: "Confira se o endereço foi copiado inteiro — links quebram ao serem encaminhados.",
  },
} as const;

export type CodigoIndisponivel = keyof typeof TEXTOS;

/**
 * Tela de link morto. De propósito SEM nenhum caminho pro painel ou pro login:
 * quem chega aqui é o cliente, não convidamos ele pra porta de trás.
 */
export function LinkIndisponivel({ code }: { code: CodigoIndisponivel }) {
  const t = TEXTOS[code] ?? TEXTOS.LINK_INVALIDO;
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
      <div className="mb-6 rounded-full bg-slate-100 p-4">
        <LinkIcon className="h-8 w-8 text-slate-400" />
      </div>
      <h1 className="text-xl font-bold text-slate-900">{t.titulo}</h1>
      <p className="mt-2 text-slate-600">{t.corpo}</p>
      <p className="mt-10 text-xs text-slate-400">Movatruck</p>
    </main>
  );
}
