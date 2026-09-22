"use client";

import { useCallback, useEffect, useState } from "react";
import { Clock, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { fetchApi, useAuthToken } from "@/lib/client-api";
import { usePermissoes } from "@/lib/permissoes";

/**
 * O estado da empresa, dito em voz alta e o tempo todo.
 *
 * Duas situações, com pesos diferentes:
 *
 * - **teste correndo** — conta os dias que faltam. Fica discreto no começo e só
 *   vira alerta na última semana, porque um aviso que grita desde o dia 1 é um
 *   aviso que ninguém lê no dia 13.
 * - **teste terminado** — sem ícone de alerta e sem âmbar de perigo. Âmbar mais
 *   triângulo é o vocabulário visual de "você fez algo errado", e o fim de uma
 *   cortesia não é falha de ninguém. A faixa lidera pelo que CONTINUA
 *   funcionando e oferece a saída; antes daqui a pessoa lia uma frase que
 *   descrevia o bloqueio e não dizia o que fazer com ele.
 */
export function AvisoConta() {
  const { estadoConta } = usePermissoes();

  if (!estadoConta) return null;

  const { podeEscrever, emTeste, diasRestantes, motivo } = estadoConta;

  if (!podeEscrever) return <FaixaTesteTerminado motivo={motivo} />;

  if (!emTeste || diasRestantes === null) return null;

  // Na última semana o aviso muda de tom. Antes disso é informação; a partir
  // daí é algo que exige uma decisão.
  const urgente = diasRestantes <= 7;
  const texto =
    diasRestantes <= 0
      ? "Seu período de teste termina hoje."
      : diasRestantes === 1
        ? "Falta 1 dia do seu período de teste."
        : `Faltam ${diasRestantes} dias do seu período de teste.`;

  return (
    <div
      role="status"
      className={
        urgente
          ? "flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-amber-300 bg-amber-100 px-4 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"
          : "flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-muted px-4 py-2 text-sm text-muted-foreground"
      }
    >
      <Clock className="h-4 w-4 shrink-0" />
      <p className="min-w-0 flex-1">{texto}</p>
      {/* Só na reta final: oferecer a conversa no dia 1 soa como cobrança. */}
      {urgente && <BotaoQueroContinuar sutil />}
    </div>
  );
}

function FaixaTesteTerminado({ motivo }: { motivo: string | null }) {
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-muted px-4 py-2 text-sm text-foreground"
    >
      <Clock className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <p className="min-w-0 flex-1">
        {motivo ??
          "Seu período de teste terminou. Tudo que você lançou continua aqui: dá pra ver, filtrar e exportar."}
      </p>
      <BotaoQueroContinuar />
    </div>
  );
}

/**
 * Abre a conversa com a Movatruck — e avisa a Movatruck que ela começou.
 *
 * O link do WhatsApp vem do servidor, não do bundle: o número é da plataforma e
 * muda sem deploy, e é lá que o aviso pro time comercial é disparado junto.
 *
 * `window.open` ANTES do `await`: navegador bloqueia popup aberto depois de um
 * `await`, porque o clique deixou de ser a causa imediata. Abre-se a aba em
 * branco no clique e escreve-se o endereço quando ele chega.
 */
function BotaoQueroContinuar({ sutil = false }: { sutil?: boolean }) {
  const token = useAuthToken();
  const [enviando, setEnviando] = useState(false);

  const pedir = useCallback(async () => {
    if (enviando) return;
    setEnviando(true);
    const aba = window.open("", "_blank", "noopener,noreferrer");
    try {
      const r = await fetchApi<{ whatsappUrl: string }>("/admin/onboarding/quero-continuar", {
        method: "POST",
        token,
      });
      if (aba) aba.location.href = r.whatsappUrl;
      else window.location.href = r.whatsappUrl;
    } catch {
      aba?.close();
      // O pedido não pode morrer em silêncio: quem clicou aqui está tentando
      // pagar. Se o caminho automático falhou, damos o caminho manual.
      toast.error("Não consegui abrir o WhatsApp", {
        description: "Fale com a gente em contato@movatruck.com.br.",
      });
    } finally {
      setEnviando(false);
    }
  }, [enviando, token]);

  // O mesmo pedido também nasce do toast que aparece quando a pessoa tenta
  // salvar algo com a conta travada (ver `providers.tsx`). Um ponto só de
  // implementação pros dois caminhos.
  useEffect(() => {
    const ouvir = () => void pedir();
    window.addEventListener("movatruck:quero-continuar", ouvir);
    return () => window.removeEventListener("movatruck:quero-continuar", ouvir);
  }, [pedir]);

  return (
    <button
      type="button"
      onClick={() => void pedir()}
      disabled={enviando}
      className={
        sutil
          ? "inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium underline underline-offset-2 hover:bg-black/5 disabled:opacity-60 dark:hover:bg-white/10"
          : "inline-flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 py-1 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
      }
    >
      {enviando && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
      Quero continuar
    </button>
  );
}
