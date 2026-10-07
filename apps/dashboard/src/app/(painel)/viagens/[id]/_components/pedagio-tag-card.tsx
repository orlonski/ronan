"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Tag } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { fetchApi, useAuthToken } from "@/lib/client-api";
import { usePermissoes } from "@/lib/permissoes";

type Passagem = { id: string; quando: string; hora: string; cidade: string; sentido: string; valor: number; vale: { viagem: string | null } | null };
type Trecho = {
  passagemAncoraId: string;
  estado: "CARREGADO" | "VAZIO" | string;
  ini: string;
  valorTag: number;
  valorVale: number;
  passagens: Passagem[];
};
type Resposta =
  | { modulo: false }
  | {
      modulo: true;
      placa: string | null;
      situacao: "SEM_TAG" | "FATURA_NAO_CHEGOU" | "NAO_CASADA" | "TAG_PAGOU";
      lancado: string;
      tag: string;
      vale: string;
      retorno: string;
      sugestao: string | null;
      diferenca: string;
      pracasSemPassagem: string[] | null;
      cliente: { nome: string | null; regua: "IDA" | "VOLTA" | "IDA_E_VOLTA"; pedagio: string; pelaTag: boolean };
      ligados: Array<Trecho & { ligacao: string | null }>;
      pendentes: Array<Trecho & { status: string }>;
      decisao: { valorReembolso: string; motivo: string | null; decididoPor: string | null; decididoEm: string } | null;
    };

const REGUA = { IDA: "só a ida", VOLTA: "só a volta", IDA_E_VOLTA: "ida e volta" } as const;
const brl = (v: string | number) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
// A hora vem da própria passagem, no fuso da praça (MT é uma hora antes de
// Brasília) — a mesma que a fatura e a tela da tag mostram.
const horario = (t: { passagens: Passagem[] }) => {
  const a = t.passagens[0];
  const b = t.passagens.at(-1);
  if (!a || !b) return "";
  return `${a.quando.slice(0, 5)} ${a.hora}${b !== a ? ` → ${b.hora}` : ""}`;
};

/**
 * "Pedágio pela tag" na ficha da viagem: o que a fatura do Sem Parar mostra
 * desta viagem (ida e volta vazia), ao lado do que o motorista lançou. Só
 * aparece com o módulo da tag e a permissão de ver a conferência.
 */
export function PedagioTagCard({ viagemId }: { viagemId: string }) {
  const token = useAuthToken();
  const { temPermissao } = usePermissoes();
  const pode = temPermissao("tag.ver");
  const q = useQuery({
    queryKey: ["viagem-tag", viagemId],
    enabled: !!token && pode,
    staleTime: 60_000,
    retry: false,
    queryFn: () => fetchApi<Resposta>(`/admin/tag-pedagio/viagens/${viagemId}`, { token: token! }),
  });
  const d = q.data;
  if (!pode || !d || !d.modulo || d.situacao === "SEM_TAG") return null;

  const placaParam = d.placa ? `&placa=${encodeURIComponent(d.placa)}` : "";
  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center gap-2">
        <Tag className="h-4 w-4 text-muted-foreground" />
        <p className="text-base font-bold">Pedágio pela tag</p>
      </div>

      {d.situacao === "FATURA_NAO_CHEGOU" && (
        <p className="text-sm text-muted-foreground">
          O caminhão tem tag, mas a fatura do Sem Parar deste dia ainda não foi importada.
        </p>
      )}
      {d.situacao === "NAO_CASADA" && d.pendentes.length === 0 && (
        <p className="text-sm text-muted-foreground">
          A fatura cobre este dia e nenhuma passagem da tag está ligada a esta viagem.
        </p>
      )}

      <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <Numero rotulo="Motorista lançou" valor={brl(d.lancado)} />
        <Numero rotulo="Tag na ida" valor={brl(d.tag)} />
        <Numero rotulo="Vale do contratante" valor={brl(d.vale)} />
        <Numero rotulo="Tag na volta vazia" valor={brl(d.retorno)} />
      </div>

      <p className="text-sm">
        Pedágio na fatura {d.cliente.nome ? `de ${d.cliente.nome}` : "do cliente"}: <strong>{brl(d.cliente.pedagio)}</strong>{" "}
        <span className="text-muted-foreground">
          {d.cliente.pelaTag
            ? `(pela tag — ${REGUA[d.cliente.regua]}; vale não entra)`
            : "(o que o motorista lançou — nenhuma passagem da tag ligada)"}
        </span>
      </p>

      {d.sugestao != null && (
        <p className="text-sm">
          {d.decisao ? (
            <span className="text-emerald-700">
              Acerto: devolver {brl(d.decisao.valorReembolso)}
              {d.decisao.decididoPor ? ` — conferido por ${d.decisao.decididoPor}` : ""}
              {d.decisao.motivo ? ` (${d.decisao.motivo})` : ""}
            </span>
          ) : (
            <>
              Sugestão pro acerto: devolver <strong>{brl(d.sugestao)}</strong>.{" "}
              {Number(d.diferenca) > 0 &&
                (d.pracasSemPassagem && d.pracasSemPassagem.length > 0
                  ? `A diferença de ${brl(d.diferenca)} tem explicação: a rota passa por ${d.pracasSemPassagem.join(", ")} e a tag não registrou.`
                  : `A diferença de ${brl(d.diferenca)} não tem explicação: ${d.pracasSemPassagem ? "todas as praças da rota foram pagas pela tag" : "não deu pra conferir a rota"}.`)}{" "}
              Quem decide é o acerto do motorista.
            </>
          )}
        </p>
      )}

      {d.ligados.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Passagens ligadas</p>
          {d.ligados.map((t) => (
            <LinhaTrecho key={t.passagemAncoraId} t={t} rotulo={t.ligacao === "RETORNO" ? "volta vazia" : t.estado === "CARREGADO" ? "carregado" : "vazio"} />
          ))}
        </div>
      )}

      {d.pendentes.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">
            Sugeridas pra esta viagem — esperando alguém confirmar
          </p>
          {d.pendentes.map((t) => (
            <LinhaTrecho
              key={t.passagemAncoraId}
              t={t}
              rotulo={t.status === "RETORNO" ? "volta vazia" : t.status === "IDA_VAZIA" ? "ida vazia" : "carregado"}
            />
          ))}
          <Button size="sm" variant="outline" asChild>
            <Link href={`/tag-pedagio?aba=casar${placaParam}&dia=${new Date(d.pendentes[0]!.ini).toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" })}`}>Conferir na tag</Link>
          </Button>
        </div>
      )}
    </Card>
  );
}

function Numero({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="rounded-md bg-muted/50 p-2">
      <p className="text-xs text-muted-foreground">{rotulo}</p>
      <p className="font-semibold tabular-nums">{valor}</p>
    </div>
  );
}

function LinhaTrecho({ t, rotulo }: { t: Trecho; rotulo: string }) {
  return (
    <div className="rounded-md border p-2 text-xs">
      <p className="font-medium">
        {horario(t)} · {rotulo} · {brl(t.valorTag)} na tag
        {t.valorVale > 0 ? ` + ${brl(t.valorVale)} de vale` : ""}
      </p>
      <p className="text-muted-foreground">
        {t.passagens.map((p) => `${p.hora} ${p.cidade} ${p.sentido.charAt(0)}${p.vale ? " (vale)" : ""}`).join(" · ")}
      </p>
    </div>
  );
}
