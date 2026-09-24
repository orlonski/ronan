"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Permitido } from "@/components/requer-tela";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { fetchApi, useAuthToken } from "@/lib/client-api";
import { hojeSP } from "@/lib/datetime-br";

type Custo = {
  manutencao: number;
  combustivel: number;
  multas: number;
  total: number;
  kmRodado: number;
  porKm: number | null;
};

type Prontuario = {
  veiculo: { id: string; placa: string; modelo: string | null; marca: string | null; anoModelo: number | null };
  km: {
    km: number | null;
    desde: string | null;
    kmViagensDepois: number;
    conferido: boolean;
    origem?: "ABASTECIMENTO" | "CONSERTO" | "CONFERIDO" | null;
  };
  situacao: "RODANDO" | "NA_OFICINA" | "PARADO";
  custoMes: Custo;
  custoAno: Custo;
  planos: {
    planoId: string;
    descricao: string;
    situacao: "EM_DIA" | "PROXIMO" | "VENCIDO" | "SEM_REFERENCIA";
    kmRestante: number | null;
    diasRestante: number | null;
  }[];
  documentos: { id: string; tipo: string; numero: string | null; validade: string | null; diasRestantes: number | null }[];
  pneus: { id: string; numeroFogo: string; posicao: string | null; sulcoMm: number | null; situacao: string }[];
  avisosAbertos: number;
  linhaDoTempo: { data: string; tipo: string; titulo: string; detalhe: string | null; valor: number | null; ref: string }[];
};

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dia = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: "UTC" });

const ROTULO_EVENTO: Record<string, string> = {
  CONSERTO_CONCLUIDO: "Conserto concluído",
  CONSERTO_ABERTO: "Conserto aberto",
  NA_OFICINA: "Na oficina",
  AVISO: "Aviso do motorista",
  MULTA: "Multa",
  ODOMETRO: "Odômetro",
};

/**
 * O PRONTUÁRIO DO CAMINHÃO: tudo sobre uma placa numa tela.
 *
 * Responde a pergunta do dono ("como está o ABC-1234?") que nenhuma tela
 * respondia — histórico, custo, revisões, documentos e pneus viviam em cinco
 * abas sem filtro por placa. Padrão do mercado (a página do veículo no
 * Fleetio), decidido com o dono em 24/09/2026.
 */
const ORIGEM_KM = {
  CONFERIDO: "Conferido",
  ABASTECIMENTO: "Anotado no abastecimento",
  CONSERTO: "Anotado no conserto",
} as const;

export function ProntuarioDoCaminhao({ veiculoId }: { veiculoId: string }) {
  const token = useAuthToken();
  const queryClient = useQueryClient();
  const [filtro, setFiltro] = React.useState("TUDO");
  const [conferindo, setConferindo] = React.useState(false);
  const [odo, setOdo] = React.useState("");
  const [lidoEm, setLidoEm] = React.useState(hojeSP());

  const q = useQuery({
    queryKey: ["prontuario", veiculoId],
    enabled: Boolean(token),
    queryFn: () => fetchApi<Prontuario>(`/admin/manutencao/veiculo/${veiculoId}/prontuario`, { token: token! }),
  });

  async function conferir() {
    if (!token) return;
    const n = Number(odo.replace(/\D/g, ""));
    if (!n) return toast.error("Informe o odômetro que está no painel do caminhão.");
    try {
      await fetchApi(`/admin/manutencao/veiculo/${veiculoId}/odometro`, {
        token,
        method: "POST",
        body: JSON.stringify({ odometro: n, lidoEm }),
      });
      toast.success("Odômetro conferido. O km do caminhão parte daqui.");
      setConferindo(false);
      setOdo("");
      await queryClient.invalidateQueries({ queryKey: ["prontuario", veiculoId] });
      await queryClient.invalidateQueries({ queryKey: ["frota-alertas"] });
    } catch (e) {
      toast.error("Não consegui salvar", { description: e instanceof Error ? e.message : undefined });
    }
  }

  if (q.isLoading) return <p className="text-sm text-muted-foreground">Carregando o prontuário…</p>;
  if (!q.data) return null;
  const p = q.data;
  const eventos = p.linhaDoTempo.filter((e) =>
    filtro === "TUDO"
      ? true
      : filtro === "CONSERTOS"
        ? e.tipo.startsWith("CONSERTO") || e.tipo === "NA_OFICINA"
        : e.tipo === filtro,
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <SeloSituacao s={p.situacao} />
        {p.avisosAbertos > 0 && (
          <Link href={"/frota" as Route} className="text-sm text-blue-700 hover:underline">
            {p.avisosAbertos} aviso(s) do motorista esperando decisão →
          </Link>
        )}
      </div>

      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <p className="text-2xl font-semibold tabular-nums">
            {p.km.km != null ? `${p.km.km.toLocaleString("pt-BR")} km` : "Km desconhecido"}
          </p>
          <p className="text-sm text-muted-foreground">
            {p.km.km == null
              ? "Ninguém anotou odômetro ainda. Confira no painel do caminhão."
              : `${ORIGEM_KM[p.km.origem ?? (p.km.conferido ? "CONFERIDO" : "ABASTECIMENTO")]} em ${dia(p.km.desde!)}${
                  p.km.kmViagensDepois > 0
                    ? ` + ${p.km.kmViagensDepois.toLocaleString("pt-BR")} km de viagens depois (estimado)`
                    : ""
                }`}
          </p>
        </div>
        <Permitido chave="manutencao.editar">
          {!conferindo ? (
            <Button size="sm" variant="outline" onClick={() => setConferindo(true)}>
              Conferir odômetro
            </Button>
          ) : (
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1">
                <Label htmlFor="pr-odo">Odômetro no painel</Label>
                <Input id="pr-odo" inputMode="numeric" className="w-36" value={odo} onChange={(e) => setOdo(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="pr-data">Lido em</Label>
                <Input id="pr-data" type="date" className="w-40" value={lidoEm} onChange={(e) => setLidoEm(e.target.value)} />
              </div>
              <Button size="sm" variant="outline" onClick={() => setConferindo(false)}>
                Cancelar
              </Button>
              <Button size="sm" variant="success" onClick={() => void conferir()}>
                Salvar leitura
              </Button>
            </div>
          )}
        </Permitido>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2">
        <CustoCard titulo="Custo no mês" c={p.custoMes} />
        <CustoCard titulo="Custo no ano" c={p.custoAno} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="space-y-3 p-4 lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold">Linha do tempo</p>
            <Select aria-label="Filtrar linha do tempo" value={filtro} onChange={(e) => setFiltro(e.target.value)} className="w-44">
              <option value="TUDO">Tudo</option>
              <option value="CONSERTOS">Consertos</option>
              <option value="AVISO">Avisos do motorista</option>
              <option value="MULTA">Multas</option>
              <option value="ODOMETRO">Odômetro</option>
            </Select>
          </div>
          {eventos.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nada registrado ainda.</p>
          ) : (
            <ul className="space-y-2">
              {eventos.map((e) => (
                <li key={`${e.tipo}-${e.ref}`} className="flex flex-wrap justify-between gap-2 border-b pb-2 text-sm last:border-0">
                  <span className="min-w-0">
                    <span className="text-muted-foreground">{dia(e.data)} · {ROTULO_EVENTO[e.tipo] ?? e.tipo}</span>
                    <span className="block font-medium">{e.titulo}</span>
                    {e.detalhe && <span className="block text-xs text-muted-foreground">{e.detalhe}</span>}
                  </span>
                  {e.valor != null && <span className="tabular-nums">{brl(e.valor)}</span>}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-4">
          <Card className="space-y-2 p-4">
            <p className="text-sm font-semibold">Revisões programadas</p>
            {p.planos.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhuma. Cadastre em{" "}
                <Link href={"/frota?aba=planos" as Route} className="text-blue-700 hover:underline">
                  Manutenção › Revisões programadas
                </Link>
                .
              </p>
            ) : (
              p.planos.map((pl) => (
                <div key={pl.planoId} className="flex justify-between gap-2 text-sm">
                  <span>{pl.descricao}</span>
                  <SeloRevisao pl={pl} />
                </div>
              ))
            )}
          </Card>
          <Card className="space-y-2 p-4">
            <p className="text-sm font-semibold">Documentos</p>
            {p.documentos.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum documento com validade cadastrada.</p>
            ) : (
              p.documentos.map((d) => (
                <div key={d.id} className="flex justify-between gap-2 text-sm">
                  <span>{d.tipo}</span>
                  <span
                    className={
                      d.diasRestantes == null
                        ? "text-muted-foreground"
                        : d.diasRestantes < 0
                          ? "font-medium text-red-700"
                          : d.diasRestantes <= 30
                            ? "font-medium text-amber-700"
                            : "text-muted-foreground"
                    }
                  >
                    {d.validade ? (d.diasRestantes! < 0 ? "vencido" : `vence ${dia(d.validade)}`) : "sem validade"}
                  </span>
                </div>
              ))
            )}
          </Card>
          <Card className="space-y-2 p-4">
            <p className="text-sm font-semibold">Pneus ({p.pneus.length})</p>
            {p.pneus.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum pneu cadastrado neste caminhão.</p>
            ) : (
              <p className="text-sm text-muted-foreground">
                {p.pneus.filter((x) => x.situacao === "CRITICO" || x.situacao === "ATENCAO").length} perto do limite
                de sulco.
              </p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function SeloSituacao({ s }: { s: Prontuario["situacao"] }) {
  const m = {
    RODANDO: ["Rodando", "bg-emerald-100 text-emerald-700"],
    NA_OFICINA: ["Na oficina", "bg-amber-100 text-amber-800"],
    PARADO: ["Parado — motorista avisou", "bg-red-100 text-red-700"],
  } as const;
  return <Badge className={`border-transparent ${m[s][1]}`}>{m[s][0]}</Badge>;
}

function SeloRevisao({ pl }: { pl: Prontuario["planos"][number] }) {
  if (pl.situacao === "SEM_REFERENCIA") return <span className="text-muted-foreground">sem última vez</span>;
  const falta =
    pl.kmRestante != null
      ? `${Math.abs(pl.kmRestante).toLocaleString("pt-BR")} km`
      : pl.diasRestante != null
        ? `${Math.abs(pl.diasRestante)} dias`
        : "";
  if (pl.situacao === "VENCIDO") return <span className="font-medium text-red-700">vencida · {falta}</span>;
  if (pl.situacao === "PROXIMO") return <span className="font-medium text-amber-700">faltam {falta}</span>;
  return <span className="text-muted-foreground">faltam {falta}</span>;
}

function CustoCard({ titulo, c }: { titulo: string; c: Custo }) {
  return (
    <Card className="p-4">
      <p className="text-sm text-muted-foreground">{titulo}</p>
      <p className="text-2xl font-semibold tabular-nums">{brl(c.total)}</p>
      <p className="text-sm text-muted-foreground">
        {c.porKm != null ? `${brl(c.porKm)}/km em ${c.kmRodado.toLocaleString("pt-BR")} km rodados` : "sem km de viagem no período"}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        Manutenção {brl(c.manutencao)} · Combustível {brl(c.combustivel)} · Multas {brl(c.multas)}
      </p>
    </Card>
  );
}
