"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Tag } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { fetchApi, useAuthToken } from "@/lib/client-api";
import { usePermissoes } from "@/lib/permissoes";

type Passagem = { id: string; hora: string; cidade: string; sentido: string; valor: number; vale: { viagem: string | null } | null };
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
      ligados: Array<Trecho & { ligacao: string | null }>;
      pendentes: Array<Trecho & { status: string }>;
      decisao: { valorReembolso: string; motivo: string | null; decididoPor: string | null; decididoEm: string } | null;
    };

const brl = (v: string | number) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const diaHora = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

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
              Sugestão pro acerto: devolver <strong>{brl(d.sugestao)}</strong> (o lançado menos o que a tag e o vale
              pagaram na ida). Quem decide é o acerto do motorista.
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
        {diaHora(t.ini)} · {rotulo} · {brl(t.valorTag)} na tag
        {t.valorVale > 0 ? ` + ${brl(t.valorVale)} de vale` : ""}
      </p>
      <p className="text-muted-foreground">
        {t.passagens.map((p) => `${p.hora} ${p.cidade} ${p.sentido.charAt(0)}${p.vale ? " (vale)" : ""}`).join(" · ")}
      </p>
    </div>
  );
}
