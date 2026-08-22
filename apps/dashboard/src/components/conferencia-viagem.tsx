"use client";

import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Eye, RefreshCw, ScanEye } from "lucide-react";
import { fetchApi, useApiQuery, useAuthToken } from "@/lib/client-api";
import { usePermissoes } from "@/lib/permissoes";

type Divergencia = {
  campo: string;
  declarado: string;
  lido: string;
  gravidade: "ALTA" | "MEDIA";
  detalhe: string;
};
type Incerteza = { campo: string; declarado: string; lido: string; motivo: string };

type Conferencia = {
  id: string;
  veredito: "BATE" | "DIVERGE" | "INCERTO" | "ILEGIVEL" | "NAO_APLICAVEL" | null;
  confianca: number | null;
  divergencias: Divergencia[] | null;
  incertezas: Incerteza[] | null;
  declarado: Record<string, unknown> | null;
  leitura: Record<string, unknown> | null;
  acao: string | null;
  passadas: number;
  criadoEm: string;
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
  const { data, isLoading, refetch } = useApiQuery<Conferencia | null>(
    `/admin/conferencias/viagem/${viagemId}`,
  );
  const { temPermissao } = usePermissoes();
  const token = useAuthToken();
  const [relendo, setRelendo] = useState(false);

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

  if (isLoading || !data || !data.veredito) return null;

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

        {/* Pra quando a foto está boa e a leitura não deu certo assim mesmo.
            Sem isto o único caminho seria pedir foto nova ao motorista por um
            problema que não é dele. */}
        {temPermissao("viagens.validar") && (
          <button
            type="button"
            onClick={() => void reler()}
            disabled={relendo}
            title="A foto está boa e a leitura não pegou? Manda ler de novo."
            className="ml-auto flex items-center gap-1 rounded border border-current/20 bg-white/60 px-2 py-0.5 text-[11px] hover:bg-white disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${relendo ? "animate-spin" : ""}`} />
            {relendo ? "lendo…" : "ler de novo"}
          </button>
        )}
      </div>

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
    </div>
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
