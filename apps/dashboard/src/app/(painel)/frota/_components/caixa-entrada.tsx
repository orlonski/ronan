"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Permitido } from "@/components/requer-tela";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { fetchApi, useAuthToken } from "@/lib/client-api";
import { CardAviso, ListaAvisos, type Aviso } from "./aviso";
import { CancelarConserto } from "./cancelar-conserto";
import { ConcluirConserto } from "./concluir-conserto";
import { brl, dataBR, type Alertas, type Manutencao, type Veiculo } from "./tipos";

/**
 * A CAIXA DE ENTRADA DA MANUTENÇÃO: o que precisa de alguém, em ordem de
 * urgência, e cada linha se resolve ali mesmo.
 *
 * Substitui as abas "Precisa de você" e "Avisos do motorista" (que repetiam o
 * mesmo conteúdo). Desenho da squad de 24/09/2026, no padrão do mercado:
 * Parados agora → Precisa de decisão → Agendado. No topo, três números.
 */
export function CaixaDeEntrada({
  a,
  onJaFeita,
  onVerAba,
}: {
  a: Alertas;
  onJaFeita: (p: { veiculo: Veiculo; planoId: string; descricao: string }) => void;
  onVerAba: (aba: "documentos" | "multas" | "pneus") => void;
}) {
  const token = useAuthToken();
  const queryClient = useQueryClient();
  const [concluindo, setConcluindo] = React.useState<Manutencao | null>(null);
  const [verHistorico, setVerHistorico] = React.useState(false);
  const [cancelando, setCancelando] = React.useState<{
    id: string;
    descricao: string;
    veiculo: Veiculo | null;
  } | null>(null);

  // Os avisos esperando decisão, já com o parado no topo (a API ordena).
  const avisos = useQuery({
    queryKey: ["problemas-veiculo", "ABERTO"],
    enabled: Boolean(token),
    queryFn: () => fetchApi<Aviso[]>("/admin/manutencao/problemas?status=ABERTO", { token: token! }),
  });
  // As OS em aberto, pra concluir sem sair daqui.
  const manutencoes = useQuery({
    queryKey: ["manutencoes"],
    enabled: Boolean(token),
    queryFn: () => fetchApi<{ data: Manutencao[] }>("/admin/manutencao?pageSize=100", { token: token! }),
  });

  async function atualizar() {
    for (const k of ["problemas-veiculo", "frota-alertas", "manutencoes", "planos-manutencao"]) {
      await queryClient.invalidateQueries({ queryKey: [k] });
    }
  }

  function abrirConclusao(id: string) {
    const m = (manutencoes.data?.data ?? []).find((x) => x.id === id);
    if (m) setConcluindo(m);
    else toast.error("Não achei esse conserto. Recarregue a página.");
  }

  async function entrouNaOficina(id: string) {
    if (!token) return;
    await fetchApi(`/admin/manutencao/${id}`, { token, method: "PATCH", body: JSON.stringify({ status: "EM_ANDAMENTO" }) });
    await atualizar();
  }

  async function agendar(m: Alertas["manutencoes"][number]) {
    if (!token) return;
    await fetchApi("/admin/manutencao", {
      token,
      method: "POST",
      body: JSON.stringify({
        veiculoId: m.veiculo.id,
        tipo: "PREVENTIVA",
        descricao: m.descricao,
        planoId: m.planoId,
        status: "ABERTA",
      }),
    });
    toast.success(`${m.descricao} do ${m.veiculo.placa} agendada.`);
    await atualizar();
  }

  const listaAvisos = avisos.data ?? [];
  const parados = listaAvisos.filter((v) => v.podeRodar === "NAO");
  const outrosAvisos = listaAvisos.filter((v) => v.podeRodar !== "NAO");
  const revisoes = a.manutencoes;
  const documentos = a.documentos;
  const multas = a.multas.filter((m) => m.diasParaIndicar != null && m.status === "RECEBIDA");
  const pneus = a.pneus;
  const agendadas = a.agendadas ?? [];

  const nParados = parados.length + a.emOficina.length;
  const nDecidir = outrosAvisos.length + revisoes.length + documentos.length + multas.length + pneus.length;

  const Placa = ({ v }: { v: Veiculo | null }) =>
    v ? (
      <Link href={`/veiculos/${v.id}` as Route} className="font-medium hover:underline">
        {v.placa}
      </Link>
    ) : (
      <span className="font-medium">sem placa</span>
    );

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <Numero titulo="Parados agora" valor={String(nParados)} destaque={nParados > 0 ? "vermelho" : undefined} />
        <Numero titulo="Precisam de decisão" valor={String(nDecidir)} destaque={nDecidir > 0 ? "amarelo" : undefined} />
        <Numero titulo="Gasto com manutenção no mês" valor={brl(a.gastoMes ?? 0)} />
      </div>

      <Bloco titulo="Parados agora" vazio="Nenhum caminhão parado.">
        {parados.map((v) => (
          <CardAviso key={v.id} a={v} onMudou={() => void atualizar()} />
        ))}
        {a.emOficina.map((m) => (
          <Linha key={m.id}>
            <span>
              <Placa v={m.veiculo} /> · Na oficina · {m.descricao}
              {m.oficina && <span className="text-muted-foreground"> · {m.oficina}</span>}
              {m.desde && (
                <span className="text-muted-foreground"> · desde {new Date(m.desde).toLocaleDateString("pt-BR")}</span>
              )}
            </span>
            <Permitido chave="manutencao.editar">
              <span className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setCancelando(m)}>
                  Cancelar conserto
                </Button>
                <Button size="sm" variant="success" onClick={() => abrirConclusao(m.id)}>
                  Concluir
                </Button>
              </span>
            </Permitido>
          </Linha>
        ))}
      </Bloco>

      <Bloco titulo="Precisa de decisão" vazio="Nada esperando decisão.">
        {outrosAvisos.map((v) => (
          <CardAviso key={v.id} a={v} onMudou={() => void atualizar()} />
        ))}
        {revisoes.map((m) => (
          <Linha key={m.planoId}>
            <span>
              <Placa v={m.veiculo} /> · {m.descricao}{" "}
              <Badge
                className={`border-transparent ${
                  m.situacao === "VENCIDO" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-800"
                }`}
              >
                {m.situacao === "VENCIDO" ? "Vencida" : "Chegando"}
                {m.motivo === "KM" && m.kmRestante != null
                  ? ` · ${Math.abs(m.kmRestante).toLocaleString("pt-BR")} km`
                  : m.diasRestante != null
                    ? ` · ${Math.abs(m.diasRestante)} dias`
                    : ""}
              </Badge>
            </span>
            <Permitido chave="manutencao.criar">
              <span className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => void agendar(m)}>
                  Agendar
                </Button>
                <Button
                  size="sm"
                  onClick={() => onJaFeita({ veiculo: m.veiculo, planoId: m.planoId, descricao: m.descricao })}
                >
                  Já foi feita
                </Button>
              </span>
            </Permitido>
          </Linha>
        ))}
        {documentos.map((d) => (
          <Linha key={d.id}>
            <span>
              <Placa v={d.veiculo} /> · {d.tipo}{" "}
              <Badge
                className={`border-transparent ${
                  (d.diasRestantes ?? 0) < 0 ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-800"
                }`}
              >
                {(d.diasRestantes ?? 0) < 0
                  ? `vencido há ${Math.abs(d.diasRestantes!)} dias`
                  : d.diasRestantes === 0
                    ? "vence hoje"
                    : `vence em ${d.diasRestantes} dias`}
              </Badge>
            </span>
            <Button size="sm" variant="outline" onClick={() => onVerAba("documentos")}>
              Atualizar vencimento
            </Button>
          </Linha>
        ))}
        {multas.map((m) => (
          <Linha key={m.id}>
            <span>
              <Placa v={m.veiculo} /> · Multa · {m.infracao}{" "}
              <Badge
                className={`border-transparent ${
                  (m.diasParaIndicar ?? 0) < 0 ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-800"
                }`}
              >
                {(m.diasParaIndicar ?? 0) < 0
                  ? "prazo de indicação perdido"
                  : `indicar condutor em ${m.diasParaIndicar} dias`}
              </Badge>
            </span>
            <Button size="sm" variant="outline" onClick={() => onVerAba("multas")}>
              Indicar condutor
            </Button>
          </Linha>
        ))}
        {pneus.map((p) => (
          <Linha key={p.id}>
            <span>
              <Placa v={p.veiculo} /> · Pneu fogo {p.numeroFogo}
              {p.posicao && ` · ${p.posicao}`}{" "}
              <Badge
                className={`border-transparent ${
                  p.situacao === "CRITICO" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-800"
                }`}
              >
                {p.sulcoMm} mm{p.situacao === "CRITICO" && " · no limite legal"}
              </Badge>
            </span>
            <Button size="sm" variant="outline" onClick={() => onVerAba("pneus")}>
              Ver pneus
            </Button>
          </Linha>
        ))}
      </Bloco>

      <Bloco titulo="Agendado" vazio="Nenhum conserto agendado.">
        {agendadas.map((m) => (
          <Linha key={m.id}>
            <span>
              <Placa v={m.veiculo} /> · {m.descricao}
              {m.previstaEm && <span className="text-muted-foreground"> · {dataBR(m.previstaEm)}</span>}
              {m.oficina && <span className="text-muted-foreground"> · {m.oficina}</span>}
            </span>
            <Permitido chave="manutencao.editar">
              <span className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => setCancelando(m)}>
                  Cancelar conserto
                </Button>
                <Button size="sm" variant="outline" onClick={() => void entrouNaOficina(m.id)}>
                  Entrou na oficina
                </Button>
                <Button size="sm" variant="success" onClick={() => abrirConclusao(m.id)}>
                  Concluir
                </Button>
              </span>
            </Permitido>
          </Linha>
        ))}
      </Bloco>

      <div>
        <button
          type="button"
          className="text-sm text-blue-700 hover:underline"
          onClick={() => setVerHistorico((v) => !v)}
        >
          {verHistorico ? "Esconder avisos já decididos" : "Ver avisos do motorista já decididos"}
        </button>
        {verHistorico && (
          <div className="mt-3">
            <ListaAvisos />
          </div>
        )}
      </div>

      <CancelarConserto manutencao={cancelando} onFechar={() => setCancelando(null)} />
      <ConcluirConserto manutencao={concluindo} aberto={concluindo !== null} onFechar={() => setConcluindo(null)} />
    </div>
  );
}

function Numero({ titulo, valor, destaque }: { titulo: string; valor: string; destaque?: "vermelho" | "amarelo" }) {
  const cor =
    destaque === "vermelho" ? "text-red-700" : destaque === "amarelo" ? "text-amber-700" : "text-foreground";
  return (
    <Card className="p-4">
      <p className={`text-2xl font-semibold tabular-nums ${cor}`}>{valor}</p>
      <p className="text-sm text-muted-foreground">{titulo}</p>
    </Card>
  );
}

function Bloco({ titulo, vazio, children }: { titulo: string; vazio: string; children: React.ReactNode }) {
  const itens = React.Children.toArray(children).flat().filter(Boolean);
  return (
    <section className="space-y-2">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{titulo}</h2>
      {itens.length === 0 ? <p className="text-sm text-muted-foreground">{vazio}</p> : children}
    </section>
  );
}

function Linha({ children }: { children: React.ReactNode }) {
  return <Card className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">{children}</Card>;
}
