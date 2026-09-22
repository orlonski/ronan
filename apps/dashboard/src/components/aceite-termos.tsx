"use client";

import { useEffect, useRef, useState } from "react";
import { FileText, Loader2 } from "lucide-react";
import type { StatusAceite, TermoPublico } from "@ronan/shared-types";
import { TextoMarkdown } from "@/components/texto-markdown";
import { Button } from "@/components/ui/button";
import { fetchApi } from "@/lib/client-api";

/**
 * O aceite dos termos, como bloqueio de tela.
 *
 * Três decisões que sustentam a prova, e que qualquer "simplificação" aqui
 * destrói:
 *
 * 1. **É bloqueante de verdade.** Não tem X, não tem "depois", não fecha no
 *    Esc nem clicando fora. Aceite que dá pra adiar é aceite que metade da base
 *    nunca deu, e aí o contrato não vale pra metade da base.
 *
 * 2. **O botão só habilita depois de rolar o texto até o fim.** Não é
 *    firula: "concordo" clicado sem o texto ter sido exibido inteiro é o
 *    argumento mais fácil de usar contra a validade do aceite. Rolar não prova
 *    leitura, mas prova EXIBIÇÃO — e exibição é o que se pode garantir.
 *
 * 3. **Manda de volta o `sha256` que recebeu.** Se o texto mudou entre carregar
 *    a tela e clicar, a API recusa. Sem isso, uma aba aberta há três dias
 *    registra concordância com um texto que nunca apareceu naquela tela.
 *
 * Só aparece quando há pendência — ver `GET /termos/status`. Bloqueio que
 * aparece sem necessidade treina o usuário a clicar sem ler, que é exatamente
 * o que esvazia a prova.
 */
export function AceiteTermos() {
  const [pendencia, setPendencia] = useState<StatusAceite["pendentes"][number] | null>(null);
  const [condicao, setCondicao] = useState<StatusAceite["condicaoComercial"]>(null);
  const [documento, setDocumento] = useState<TermoPublico | null>(null);
  const [leuAteOFim, setLeuAteOFim] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const caixa = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const s = await fetchApi<StatusAceite>("/termos/status");
        if (!vivo || s.pendentes.length === 0) return;
        const p = s.pendentes[0];
        if (!p) return;
        const docs = await fetchApi<TermoPublico[]>(`/termos?tipo=${p.tipo}`);
        const doc = docs.find((d) => d.id === p.termoVersaoId);
        if (!vivo || !doc) return;
        setPendencia(p);
        setDocumento(doc);
        setCondicao(s.condicaoComercial);
      } catch {
        // Falha ao consultar não pode trancar ninguém fora do painel. Se a API
        // está fora, o problema do usuário não é o contrato.
      }
    })();
    return () => {
      vivo = false;
    };
  }, []);

  // Texto curto (ou tela grande) nunca gera rolagem — e aí o botão ficaria
  // desabilitado pra sempre. Se já cabe inteiro, já foi exibido inteiro.
  useEffect(() => {
    const el = caixa.current;
    if (!el || !documento) return;
    if (el.scrollHeight <= el.clientHeight + 8) setLeuAteOFim(true);
  }, [documento]);

  if (!pendencia || !documento) return null;

  const rotulo = pendencia.tipo === "USO" ? "Termos de Uso" : "Política de Privacidade";

  async function aceitar() {
    setEnviando(true);
    setErro(null);
    try {
      await fetchApi("/termos/aceitar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          termoVersaoId: documento!.id,
          sha256: documento!.sha256,
        }),
      });
      // Recarrega em vez de só esconder: pode haver um segundo documento
      // pendente, e o painel inteiro relê o estado da conta.
      window.location.reload();
    } catch (e) {
      setErro(
        e instanceof Error && e.message.includes("mudou enquanto")
          ? "O texto foi atualizado enquanto esta página estava aberta. Recarregue para ler a versão atual."
          : "Não consegui registrar o aceite. Tente de novo em instantes.",
      );
      setEnviando(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="titulo-aceite"
      // Marca que o passo a passo procura antes de abrir sozinho: enquanto
      // este modal estiver de pé, ele é a única coisa com que dá pra interagir.
      data-aceite-termos=""
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 pt-safe pb-safe"
    >
      <div className="flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-background shadow-xl">
        <div className="border-b border-border px-6 py-4">
          <div className="flex items-center gap-x-3">
            <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
            <h2 id="titulo-aceite" className="text-lg font-semibold">
              {pendencia.primeiroAceite
                ? `${rotulo} — leia antes de continuar`
                : `${rotulo} foram atualizados`}
            </h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Versão {documento.versao}
            {pendencia.primeiroAceite
              ? ". Para usar o sistema você precisa aceitar estas condições."
              : ". Leia o que mudou e aceite para continuar."}
          </p>

          {/* A CONDIÇÃO COMERCIAL, acima do contrato.
              O texto diz que o valor é "o combinado por escrito" e não traz
              preço — um documento só serve pra todo cliente, e desconto não
              pode exigir versão nova. Este bloco é esse "por escrito"
              aparecendo na hora em que importa: sem ele, a pessoa aceitaria um
              contrato que remete a uma combinação que ela nunca viu. */}
          {condicao ? (
            <div className="mt-3 rounded-md border border-border bg-muted/50 px-3 py-2 text-sm">
              <p className="font-medium text-foreground">Sua condição comercial</p>
              <p className="mt-0.5 text-muted-foreground">
                {(condicao.valorCentavos / 100).toLocaleString("pt-BR", {
                  style: "currency",
                  currency: "BRL",
                })}{" "}
                por {condicao.ciclo === "ANUAL" ? "ano" : "mês"} · vencimento todo dia{" "}
                {condicao.diaVencimento}
              </p>
            </div>
          ) : null}

          {/* Pedir que alguém releia 2.500 palavras sem dizer o que mudou é
              pedir que ele clique sem ler. */}
          {!pendencia.primeiroAceite && pendencia.oQueMudou ? (
            <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
              <strong className="font-medium">O que mudou:</strong> {pendencia.oQueMudou}
            </div>
          ) : null}
        </div>

        <div
          ref={caixa}
          onScroll={(e) => {
            const el = e.currentTarget;
            if (el.scrollTop + el.clientHeight >= el.scrollHeight - 24) setLeuAteOFim(true);
          }}
          className="min-h-0 flex-1 overflow-y-auto px-6 py-4"
        >
          <TextoMarkdown texto={documento.corpo} />
        </div>

        <div className="border-t border-border px-6 py-4">
          {erro ? <p className="mb-3 text-sm text-destructive">{erro}</p> : null}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">
              {leuAteOFim
                ? condicao
                  ? "Ao aceitar, registramos seu nome, a data, a hora, a versão e o valor acima."
                  : "Ao aceitar, registramos seu nome, a data, a hora e a versão."
                : "Role o texto até o fim para habilitar o aceite."}
            </p>
            <Button
              variant="success"
              disabled={!leuAteOFim || enviando}
              onClick={aceitar}
              className="shrink-0"
            >
              {enviando ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Registrando…
                </>
              ) : (
                "Li e aceito"
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
