"use client";

import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { ShieldAlert } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { fetchApi, useApiQuery, useAuthToken } from "@/lib/client-api";
import { usePermissoes } from "@/lib/permissoes";

type Previa = {
  total: number;
  aprovadasPelaIa: number;
  emFechamento: number;
  custoPorLeituraUsd?: number;
  custoEstimadoUsd?: number;
  custoMedido: boolean;
};

type Gravidade = "PESO_OU_TICKET" | "PLACA_OU_DATA" | "SEM_CONCLUSAO" | "SO_VINCULO";

type Resultado = {
  contagem: Record<string, number>;
  itens: {
    viagemId: string;
    gravidade: Gravidade;
    ticket: string | null;
    data: string | null;
    statusViagem: string;
    aprovadaPelaIa: boolean;
    motorista: string | null;
    campos: { campo: string; lancado: string; lido: string }[];
  }[];
};

const GRAVIDADE: Record<Gravidade, { rotulo: string; cor: string }> = {
  PESO_OU_TICKET: { rotulo: "Peso ou ticket", cor: "bg-red-100 text-red-800" },
  PLACA_OU_DATA: { rotulo: "Placa ou data", cor: "bg-amber-100 text-amber-900" },
  SEM_CONCLUSAO: { rotulo: "Sem conclusão", cor: "bg-slate-100 text-slate-800" },
  SO_VINCULO: { rotulo: "Só falta vincular nome", cor: "bg-sky-100 text-sky-900" },
};

const ROTULO_CAMPO: Record<string, string> = {
  toneladas: "Toneladas",
  ticket: "Ticket",
  placa: "Placa",
  data: "Data",
  cliente: "Obra",
  material: "Material",
};

/** Dia da viagem (gravado como data, sem hora que importe). */
const fmtDia = (d: string | null) => (d ? d.slice(0, 10).split("-").reverse().join("/") : "—");

const brl = (usd: number) => `R$ ${(usd * 5.45).toFixed(2).replace(".", ",")}`;

/**
 * Releitura às cegas do que a IA disse que conferia antes de 05/10/2026.
 *
 * Até ali a leitura via o lançado junto da foto e copiava o que o papel não
 * trazia. Esta seção mostra quantas viagens estão nessa situação e quanto custa
 * reler — e só relê quando alguém clica, confirmando aquele número. A releitura
 * nunca mexe na viagem: o que ela achar aparece na lista abaixo, do mais grave
 * pro menos, e quem decide é gente.
 */
export function AuditoriaCega() {
  const { temPermissao, plataforma } = usePermissoes();
  const token = useAuthToken();
  const podeRodar = temPermissao("conferencia-ticket.reprocessar");
  const previa = useApiQuery<Previa>(podeRodar ? "/admin/conferencias/auditoria-cega" : undefined);
  const resultado = useApiQuery<Resultado>("/admin/conferencias/auditoria-cega/resultado", {
    refetchInterval: 15_000,
  });
  const [confirmando, setConfirmando] = useState(false);
  const [enviando, setEnviando] = useState(false);

  const p = previa.data;
  const r = resultado.data;
  const jaRodou = !!r && (Object.values(r.contagem).reduce((a, b) => a + b, 0) > 0);
  if (!(p && p.total > 0) && !jaRodou) return null;

  async function executar() {
    if (!p) return;
    setEnviando(true);
    try {
      const res = await fetchApi<{ enfileiradas: number; motivo?: string }>(
        "/admin/conferencias/auditoria-cega",
        { method: "POST", token, body: JSON.stringify({ esperado: p.total }) },
      );
      if (res.motivo) {
        toast.error(res.motivo);
      } else {
        toast.success(`${res.enfileiradas} viagem(ns) na fila pra reler`, {
          description: "Nada muda nas viagens. O que a releitura achar aparece aqui.",
        });
      }
      setConfirmando(false);
      void previa.refetch();
      void resultado.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não consegui pôr na fila.");
    } finally {
      setEnviando(false);
    }
  }

  const c = r?.contagem ?? {};
  const custo = p?.custoEstimadoUsd != null && plataforma ? brl(p.custoEstimadoUsd) : null;

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-start gap-2">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
        <div>
          <p className="text-sm font-medium">Reler às cegas o que foi aprovado antes de 05/10</p>
          <p className="text-sm text-muted-foreground">
            Até 05/10 a leitura via o que o motorista lançou junto com a foto e às vezes copiava o
            lançado quando o papel não trazia o campo. Reler agora, sem ver o lançado, mostra se o
            &quot;confere&quot; era verdade. <strong>Nada muda nas viagens</strong>: o resultado
            aparece aqui embaixo pra você decidir.
          </p>
        </div>
      </div>

      {p && p.total > 0 && podeRodar && (
        <div className="flex flex-wrap items-center gap-3 rounded border bg-muted/30 p-3 text-sm">
          <span>
            <strong>{p.total}</strong> viagem(ns) disseram &quot;confere&quot; antes do conserto
            {p.aprovadasPelaIa > 0 && <> — {p.aprovadasPelaIa} aprovada(s) sozinha(s) pela IA</>}
            {p.emFechamento > 0 && <>, {p.emFechamento} já em fechamento</>}.
            {custo && (
              <>
                {" "}
                Custo {p.custoMedido ? "estimado" : "aproximado"}: <strong>{custo}</strong>.
              </>
            )}
          </span>
          {!confirmando ? (
            <Button variant="warning" size="sm" className="ml-auto" onClick={() => setConfirmando(true)}>
              Reler {p.total} viagem(ns)
            </Button>
          ) : (
            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs">
                Reler {p.total}
                {custo && <> por {custo}</>}?
              </span>
              <Button variant="success" size="sm" disabled={enviando} onClick={() => void executar()}>
                {enviando ? "Pondo na fila…" : "Reler agora"}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setConfirmando(false)}>
                Cancelar
              </Button>
            </div>
          )}
        </div>
      )}

      {jaRodou && (
        <>
          <div className="flex flex-wrap gap-2 text-xs">
            {(c.naFila ?? 0) > 0 && <Contador rotulo="Na fila" n={c.naFila ?? 0} cor="bg-slate-100" />}
            <Contador rotulo="Peso ou ticket" n={c.PESO_OU_TICKET ?? 0} cor="bg-red-100 text-red-800" />
            <Contador rotulo="Placa ou data" n={c.PLACA_OU_DATA ?? 0} cor="bg-amber-100 text-amber-900" />
            <Contador rotulo="Sem conclusão" n={c.SEM_CONCLUSAO ?? 0} cor="bg-slate-100" />
            <Contador rotulo="Só falta vincular nome" n={c.SO_VINCULO ?? 0} cor="bg-sky-100 text-sky-900" />
            <Contador rotulo="Confere de verdade" n={c.CONFERE ?? 0} cor="bg-emerald-100 text-emerald-800" />
            {(c.falhou ?? 0) > 0 && <Contador rotulo="Não leu" n={c.falhou ?? 0} cor="bg-slate-100" />}
          </div>

          {(c.SO_VINCULO ?? 0) > 0 && (
            <p className="text-xs text-muted-foreground">
              &quot;Só falta vincular nome&quot;: o papel traz um nome de obra ou material que ninguém
              vinculou ao cadastro. Vincular na viagem resolve todas as que têm o mesmo nome, sem
              ler de novo.
            </p>
          )}

          {r!.itens.length > 0 && (
            <ul className="divide-y rounded border text-sm">
              {r!.itens.map((i) => (
                <li key={i.viagemId} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-2">
                  <span className={`rounded px-1.5 py-0.5 text-[11px] ${GRAVIDADE[i.gravidade].cor}`}>
                    {GRAVIDADE[i.gravidade].rotulo}
                  </span>
                  <Link href={`/viagens/${i.viagemId}`} className="font-medium underline hover:no-underline">
                    Ticket {i.ticket ?? "—"}
                  </Link>
                  <span className="text-muted-foreground">
                    {fmtDia(i.data)}
                    {i.motorista && <> · {i.motorista}</>} · {i.statusViagem}
                    {i.aprovadaPelaIa && <> · aprovada pela IA</>}
                  </span>
                  <span className="w-full text-xs text-muted-foreground">
                    {i.campos.map((f, k) => (
                      <span key={k} className="mr-3">
                        {ROTULO_CAMPO[f.campo] ?? f.campo}: lançado <strong>{f.lancado}</strong> · papel{" "}
                        <strong>{f.lido}</strong>
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Card>
  );
}

function Contador({ rotulo, n, cor }: { rotulo: string; n: number; cor: string }) {
  return (
    <span className={`rounded px-2 py-1 ${cor}`}>
      {rotulo}: <strong>{n}</strong>
    </span>
  );
}
