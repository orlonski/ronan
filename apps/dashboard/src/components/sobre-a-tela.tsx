"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, Check, ChevronDown, HelpCircle, X } from "lucide-react";
import { sobreATela } from "@/lib/sobre-as-telas";
import { cn } from "@/lib/utils";

/**
 * "PARA QUE SERVE ESTA TELA", em cima de toda tela que tiver resposta.
 *
 * ⚠️ Aberta na PRIMEIRA vez, fechada pra sempre depois. É a regra inteira, e
 * ela resolve a tensão do pedido: quem chega pela primeira vez precisa da
 * explicação sem procurar por ela; quem abre a mesma tela quatro vezes por dia
 * não pode pagar por ela nenhuma vez a mais. Nada aqui julga se a pessoa é
 * nova — o aparelho só lembra se ESTA tela já foi explicada.
 *
 * ⚠️ E ela nunca some de vez: fechada, vira uma linha discreta que continua
 * clicável. Explicação que desaparece pra sempre depois do primeiro dia é a
 * que ninguém acha no dia em que precisa — e quem precisa de novo costuma ser
 * o funcionário que entrou em março, no computador de outra pessoa.
 *
 * ⚠️ Mora no shell do painel, escolhida pela ROTA. Se dependesse de cada tela
 * lembrar de renderizar, metade não teria — e seriam as menos usadas, que são
 * exatamente as que mais precisam de explicação.
 *
 * ⚠️ E mora DENTRO do `TelaGuard`: quem não tem a permissão, ou cuja empresa
 * não contratou o módulo, não vê explicação nenhuma. Descrever em três
 * linhas o que a pessoa não pode abrir não ajuda ninguém.
 */
export function SobreATela() {
  const pathname = usePathname();
  const dados = sobreATela(pathname);
  const chave = `ronan.sobre-a-tela.${pathname}`;

  /** `null` = ainda não li o disco. Renderizar antes faria a tela piscar. */
  const [aberta, setAberta] = useState<boolean | null>(null);

  useEffect(() => {
    setAberta(null);
    if (!dados) return;
    try {
      // Nunca visto = abre. O valor guardado é só a marca de "já mostrei".
      setAberta(localStorage.getItem(chave) === null);
    } catch {
      // Navegador sem storage (janela anônima, cookie bloqueado): mostra
      // fechada. Errar pro lado de não atrapalhar quem está trabalhando.
      setAberta(false);
    }
  }, [chave, dados]);

  function fechar() {
    setAberta(false);
    try {
      localStorage.setItem(chave, "1");
    } catch {
      /* sem storage: reabre na próxima visita, e tudo bem */
    }
  }

  if (!dados || aberta === null) return null;

  if (!aberta) {
    return (
      <button
        type="button"
        onClick={() => setAberta(true)}
        className={cn(
          "group mb-4 flex items-center gap-1.5 text-xs text-muted-foreground/70",
          "transition-colors hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        )}
      >
        <HelpCircle className="h-3.5 w-3.5" />
        Para que serve esta tela
        <ChevronDown className="h-3 w-3 transition-transform group-hover:translate-y-0.5" />
      </button>
    );
  }

  return (
    <section
      aria-label="Para que serve esta tela"
      className="mb-6 overflow-hidden rounded-xl border border-primary/20 bg-primary/[0.04]"
    >
      <div className="flex items-start gap-3 p-4 md:p-5">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <HelpCircle className="h-4 w-4 text-primary" />
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-medium leading-relaxed text-foreground">{dados.oQue}</p>

          <ul className="mt-3 space-y-1.5">
            {dados.faz.map((linha) => (
              <li key={linha} className="flex items-start gap-2 text-sm text-muted-foreground">
                <Check className="mt-[3px] h-3.5 w-3.5 shrink-0 text-primary/70" />
                <span className="leading-relaxed">{linha}</span>
              </li>
            ))}
          </ul>

          {/* A saída pra quem abriu a tela errada. Vem por último e separada:
              quem já está no lugar certo não precisa nem ler. */}
          {dados.naoEAqui && (
            <p className="mt-3 border-t border-primary/15 pt-3 text-sm text-muted-foreground">
              Procurando {dados.naoEAqui.procurando}?{" "}
              <Link
                href={dados.naoEAqui.href as never}
                className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
              >
                {dados.naoEAqui.vaEm}
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={fechar}
          aria-label="Entendi, fechar a explicação"
          className="-m-1 shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-primary/10 hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </section>
  );
}
