"use client";

import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Clock, Eye, PlugZap, RefreshCw, ScanEye } from "lucide-react";
import { fetchApi, useApiQuery, useAuthToken } from "@/lib/client-api";
import { usePermissoes } from "@/lib/permissoes";
import { fmtDataHoraBR } from "@/lib/fechamento-helpers";
import { humanizarErroConferencia, rotuloStatusConferencia } from "@/lib/conferencia-erro";

type Divergencia = {
  campo: string;
  declarado: string;
  lido: string;
  gravidade: "ALTA" | "MEDIA";
  detalhe: string;
};
type Incerteza = { campo: string; declarado: string; lido: string; motivo: string };

/** Uma passada da leitura — o que a linha do tempo da viagem mostra. */
type Tentativa = {
  id: string;
  status: string;
  veredito: string | null;
  confianca: number | null;
  origem: string;
  erro: string | null;
  modelo: string | null;
  passadas: number;
  duracaoMs: number | null;
  criadoEm: string;
  finalizadoEm: string | null;
};

type Conferencia = {
  id: string | null;
  veredito: "BATE" | "DIVERGE" | "INCERTO" | "ILEGIVEL" | "NAO_APLICAVEL" | null;
  confianca: number | null;
  divergencias: Divergencia[] | null;
  incertezas: Incerteza[] | null;
  declarado: Record<string, unknown> | null;
  leitura: Record<string, unknown> | null;
  acao: string | null;
  passadas: number;
  criadoEm: string;
  /** O lançamento mudou depois desta leitura — a comparação está velha. */
  desatualizada: boolean;
  /** Tem leitura na fila agora. */
  naFila: { status: string; tentativas: number; criadoEm: string } | null;
  /** A última tentativa caiu — e ainda não houve leitura boa depois dela. */
  falha: {
    erro: string | null;
    tentativas: number;
    /** O erro tem cara de transitório e o sistema ainda vai tentar sozinho. */
    ressuscitavel: boolean;
    finalizadoEm: string | null;
  } | null;
  historico: Tentativa[];
};

const CAMPOS: { chave: string; leituraChave: string; rotulo: string }[] = [
  { chave: "ticket", leituraChave: "ticket", rotulo: "Ticket" },
  { chave: "toneladas", leituraChave: "toneladas", rotulo: "Toneladas" },
  { chave: "data", leituraChave: "data", rotulo: "Data" },
  { chave: "placa", leituraChave: "placa", rotulo: "Placa" },
  { chave: "clienteNome", leituraChave: "clienteNome", rotulo: "Cliente" },
  { chave: "materialNome", leituraChave: "materialNome", rotulo: "Material" },
];

/**
 * O que a leitura automática viu neste ticket, lado a lado com o que o
 * motorista lançou.
 *
 * Fica na tela da viagem, e não só numa lista à parte, porque é aqui que a
 * conferência acontece: quem confere quer o número do ticket ao lado da foto,
 * não um relatório noutro lugar. A lista serve pra acompanhar o conjunto; este
 * card serve pra decidir uma viagem.
 */
export function ConferenciaViagemCard({ viagemId }: { viagemId: string }) {
  const { temPermissao } = usePermissoes();
  // O gate mora AQUI, e não em quem monta a tela de viagem: o endpoint por trás
  // é de plataforma, então pra um admin de empresa a chamada volta 403 e o card
  // ficaria vazio sem explicar nada. Barrar antes de pedir evita o 403 de fundo
  // — e vale automaticamente em qualquer tela que use este card depois.
  const podeVer = temPermissao("conferencia-ticket.ver");
  const { data, isLoading, refetch } = useApiQuery<Conferencia | null>(
    podeVer ? `/admin/conferencias/viagem/${viagemId}` : undefined,
  );
  const token = useAuthToken();
  const [relendo, setRelendo] = useState(false);
  const [reavaliando, setReavaliando] = useState(false);

  if (!podeVer) return null;

  /**
   * Reavaliar é o botão barato, e por isso vem antes do "ler de novo" na
   * cabeça de quem confere: compara de novo contra o que está lançado agora,
   * usando a leitura que já foi paga.
   */
  async function reavaliar() {
    setReavaliando(true);
    try {
      const r = await fetchApi<{
        recomparada: boolean;
        motivo?: string;
        mudou?: boolean;
        reverteu?: boolean;
      }>(`/admin/conferencias/viagem/${viagemId}/recomparar`, {
        method: "POST",
        token,
        body: "{}",
      });
      if (!r.recomparada) {
        toast.error(r.motivo ?? "Não consegui reavaliar.");
      } else if (r.reverteu) {
        toast.success("Confere — a viagem saiu da revisão", {
          description: "Sem custo: só a comparação rodou de novo.",
        });
      } else {
        toast.success(r.mudou ? "Reavaliei e o resultado mudou" : "Reavaliei — o resultado é o mesmo", {
          description: "Sem custo: a leitura já estava guardada.",
        });
      }
      void refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não consegui reavaliar.");
    } finally {
      setReavaliando(false);
    }
  }

  async function reler() {
    setRelendo(true);
    try {
      const r = await fetchApi<{ enfileirada: boolean; motivo?: string }>(
        `/admin/conferencias/viagem/${viagemId}/reler`,
        { method: "POST", token, body: "{}" },
      );
      if (r.enfileirada) {
        toast.success("Vou ler de novo", { description: "O resultado aparece aqui em instantes." });
        setTimeout(() => void refetch(), 8_000);
      } else {
        toast.error(r.motivo ?? "Não consegui mandar reler.");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não consegui mandar reler.");
    } finally {
      setRelendo(false);
    }
  }

  if (isLoading || !data) return null;

  const historico = data.historico ?? [];

  // Pra quando a foto está boa e a leitura não deu certo assim mesmo. Sem isto
  // o único caminho seria pedir foto nova ao motorista por um problema que não
  // é dele. Fica numa variável porque os três estados do card oferecem o mesmo
  // botão — inclusive o de falha, que é justamente onde ele mais serve.
  const botaoReler = temPermissao("conferencia-ticket.reprocessar") ? (
    <button
      type="button"
      onClick={() => void reler()}
      disabled={relendo}
      title="A foto está boa e a leitura não pegou? Manda ler de novo."
      className="flex items-center gap-1 rounded border border-current/20 bg-white/60 px-2 py-0.5 text-[11px] hover:bg-white disabled:opacity-50"
    >
      <RefreshCw className={`h-3 w-3 ${relendo ? "animate-spin" : ""}`} />
      {relendo ? "lendo…" : "ler de novo"}
    </button>
  ) : null;

  // Ainda não houve leitura concluída — e mesmo assim há o que contar: tem uma
  // na fila, ou a última caiu. Antes disto o card sumia por completo, e a
  // viagem ficava igual à de quem nunca teve conferência: sem sinal de que
  // houve tentativa e sem o botão de mandar ler de novo.
  if (!data.veredito) {
    if (data.naFila) {
      return (
        <div className="rounded-lg border border-border bg-muted/30 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Clock className="h-4 w-4 shrink-0" />
            <span className="text-sm font-medium">Leitura do ticket: na fila</span>
            <span className="text-xs text-muted-foreground">
              desde {fmtDataHoraBR(data.naFila.criadoEm)}
            </span>
          </div>
          <HistoricoLeituras tentativas={historico} />
        </div>
      );
    }

    if (data.falha) {
      return (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
          <div className="flex flex-wrap items-center gap-2 text-amber-900">
            <PlugZap className="h-4 w-4 shrink-0" />
            <span className="text-sm font-medium">Leitura do ticket: não deu pra ler</span>
            <span className="ml-auto">{botaoReler}</span>
          </div>
          <p className="mt-2 text-sm text-amber-900">
            {humanizarErroConferencia(data.falha.erro) ?? "a leitura falhou."}
          </p>
          {/* Dizer que a viagem não foi tocada importa tanto quanto dizer que
              falhou: sem isso, quem confere fica sem saber se precisa desfazer
              alguma coisa antes de decidir. */}
          <p className="mt-1 text-xs text-muted-foreground">
            {data.falha.ressuscitavel
              ? "Vou tentar de novo sozinho mais tarde — falha de conexão não chega a custar leitura. "
              : "Não vou tentar sozinho de novo: use ler de novo quando quiser. "}
            A viagem não foi alterada e o motorista não foi avisado; ela segue na fila normal de
            conferência.
          </p>
          <HistoricoLeituras tentativas={historico} />
        </div>
      );
    }

    return null;
  }

  const divs = data.divergencias ?? [];
  const incs = data.incertezas ?? [];
  const declarado = data.declarado ?? {};
  const leitura = data.leitura ?? {};

  const meta =
    data.veredito === "BATE"
      ? { rotulo: "Confere com o ticket", cor: "border-emerald-300 bg-emerald-50", texto: "text-emerald-900", Icone: CheckCircle2 }
      : data.veredito === "DIVERGE"
        ? { rotulo: "Não bate com o ticket", cor: "border-red-300 bg-red-50", texto: "text-red-900", Icone: AlertTriangle }
        : data.veredito === "ILEGIVEL"
        ? { rotulo: "Foto ilegível — pedi outra ao motorista", cor: "border-amber-300 bg-amber-50", texto: "text-amber-900", Icone: Eye }
        : data.veredito === "INCERTO"
          ? { rotulo: "Precisa de um olho humano", cor: "border-amber-300 bg-amber-50", texto: "text-amber-900", Icone: Eye }
          : { rotulo: "Não havia o que conferir", cor: "border-border bg-muted/30", texto: "", Icone: Eye };

  return (
    <div className={`rounded-lg border p-3 ${meta.cor}`}>
      <div className={`flex flex-wrap items-center gap-2 ${meta.texto}`}>
        <meta.Icone className="h-4 w-4 shrink-0" />
        <span className="text-sm font-medium">Leitura do ticket: {meta.rotulo}</span>
        {data.confianca != null && (
          <span className="rounded border border-current/20 bg-white/60 px-1.5 py-0.5 text-[11px]">
            leitura {Math.round(data.confianca * 100)}%
          </span>
        )}
        {data.passadas > 1 && (
          <span className="rounded border border-current/20 bg-white/60 px-1.5 py-0.5 text-[11px]">
            2ª opinião
          </span>
        )}

        {/* Compara de novo com as regras de hoje, contra o que está lançado
            agora. Não gasta leitura — daí vir antes do "ler de novo" e não
            pedir a permissão de reprocessar. */}
        <button
          type="button"
          onClick={() => void reavaliar()}
          disabled={reavaliando}
          title="Compara de novo com o que está lançado agora. Não gasta leitura."
          className="ml-auto flex items-center gap-1 rounded border border-current/20 bg-white/60 px-2 py-0.5 text-[11px] hover:bg-white disabled:opacity-50"
        >
          <ScanEye className={`h-3 w-3 ${reavaliando ? "animate-pulse" : ""}`} />
          {reavaliando ? "reavaliando…" : "reavaliar sem custo"}
        </button>

        {botaoReler}
      </div>

      {/* Houve tentativa depois desta leitura, e ela caiu. Sem esta linha o
          card mostraria só o resultado velho, e uma releitura que não chegou a
          acontecer passaria por leitura feita. */}
      {data.falha && (
        <p className="mt-2 rounded border border-current/20 bg-white/60 px-2 py-1 text-xs">
          A última tentativa de reler (
          {fmtDataHoraBR(data.falha.finalizadoEm)}) falhou:{" "}
          {humanizarErroConferencia(data.falha.erro)} O que está abaixo é a leitura anterior.
        </p>
      )}

      {/* O "Lançado" abaixo é o que estava lançado quando a leitura foi
          comparada. Editar a viagem não refaz a conferência sozinho, e sem
          este aviso a tabela parecia teimar num valor que já não existe. */}
      {data.desatualizada && (
        <p className="mt-2 rounded border border-current/20 bg-white/60 px-2 py-1 text-xs">
          O lançamento mudou depois desta leitura. A comparação abaixo é da versão
          anterior — use <strong>reavaliar sem custo</strong> pra conferir com os dados de agora.
        </p>
      )}

      {/* A comparação campo a campo. É o que responde "e daí?": mostra
          exatamente onde olhar na foto, em vez de só dar um parecer. */}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[420px] text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="pb-1 pr-3 font-normal">Campo</th>
              <th className="pb-1 pr-3 font-normal">Lançado</th>
              <th className="pb-1 font-normal">No ticket</th>
            </tr>
          </thead>
          <tbody>
            {CAMPOS.map(({ chave, leituraChave, rotulo }) => {
              const dec = fmt(declarado[chave]);
              const lid = fmt(leitura[leituraChave]);
              if (dec === "—" && lid === "—") return null;

              const div = divs.find((d) => campoBate(d.campo, chave));
              const inc = incs.find((i) => campoBate(i.campo, chave));
              const cor = div
                ? div.gravidade === "ALTA"
                  ? "text-red-700 font-medium"
                  : "text-amber-800"
                : inc
                  ? "text-amber-800"
                  : "";

              return (
                <tr key={chave} className="border-t border-current/10">
                  <td className="py-1 pr-3 text-muted-foreground">{rotulo}</td>
                  <td className="py-1 pr-3 tabular-nums">{dec}</td>
                  <td className={`py-1 tabular-nums ${cor}`}>
                    {lid}
                    {inc && <span className="ml-1 text-xs">({inc.motivo})</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {incs.length > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          Diferença marcada como provável erro de leitura não vira cobrança pro motorista — a decisão
          fica com você.
        </p>
      )}

      {data.veredito === "ILEGIVEL" && (
        <p className="mt-2 text-xs text-muted-foreground">
          Já tentei com o modelo mais forte antes de desistir. Se a foto estiver boa, use{" "}
          <strong>ler de novo</strong> — melhor que pedir outra foto ao motorista por um problema
          que pode não ser dele.
        </p>
      )}

      {data.acao === "NENHUMA" && data.veredito !== "BATE" && (
        <p className="mt-2 text-xs text-muted-foreground">
          Modo observação: a leitura foi registrada, mas nada foi alterado na viagem e o motorista não
          foi avisado.
        </p>
      )}

      <HistoricoLeituras tentativas={historico} />
    </div>
  );
}

/**
 * Toda tentativa de leitura desta viagem, da mais nova pra mais velha.
 *
 * Fica fechado por padrão porque o normal é ter uma linha só e ela já está
 * contada acima. O valor está no caso torto: leitura que caiu, voltou sozinha e
 * deu certo na segunda; releitura pedida por alguém; troca de modelo no meio.
 * Sem isto, nada disso deixava rastro na viagem — e a única forma de reconstruir
 * o que houve era abrir a tela de Conferências e caçar pelo ticket.
 */
function HistoricoLeituras({ tentativas }: { tentativas: Tentativa[] }) {
  if (tentativas.length < 2) return null;

  return (
    <details className="mt-3 text-xs">
      <summary className="cursor-pointer text-muted-foreground hover:underline">
        {tentativas.length} tentativas de leitura
      </summary>
      <ul className="mt-2 space-y-1">
        {tentativas.map((t) => {
          const erro = humanizarErroConferencia(t.erro);
          return (
            <li key={t.id} className="border-t border-current/10 pt-1">
              <span className="tabular-nums text-muted-foreground">{fmtDataHoraBR(t.criadoEm)}</span>{" "}
              · {rotuloStatusConferencia(t.status, t.veredito)}
              {t.confianca != null && t.status === "CONCLUIDA" && (
                <> · leitura {Math.round(t.confianca * 100)}%</>
              )}
              {t.passadas > 1 && <> · 2ª opinião</>}
              {t.duracaoMs != null && <> · {(t.duracaoMs / 1000).toFixed(1)}s</>}
              {erro && <span className="text-amber-800"> — {erro}</span>}
            </li>
          );
        })}
      </ul>
    </details>
  );
}

/** "toneladas" no comparador × "toneladas" aqui — e cliente/material com sufixo. */
function campoBate(campoDaRegra: string, chaveLocal: string): boolean {
  if (campoDaRegra === chaveLocal) return true;
  if (campoDaRegra === "cliente" && chaveLocal === "clienteNome") return true;
  if (campoDaRegra === "material" && chaveLocal === "materialNome") return true;
  return false;
}

function fmt(v: unknown): string {
  if (v == null || v === "") return "—";
  if (typeof v === "number") return String(v).replace(".", ",");
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) {
    const [a, m, d] = v.slice(0, 10).split("-");
    return `${d}/${m}/${a}`;
  }
  return String(v);
}
