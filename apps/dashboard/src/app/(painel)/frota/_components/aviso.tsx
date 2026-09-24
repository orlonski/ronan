"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  PODE_RODAR_LABEL,
  TIPO_MANUTENCAO_LABEL,
  TIPOS_MANUTENCAO,
  type TipoManutencaoTipo,
} from "@ronan/shared-types";
import { Permitido } from "@/components/requer-tela";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { LoadingCard } from "@/components/loading";
import { FornecedorCombobox, VeiculoCombobox } from "@/components/fk-comboboxes";
import { fetchApi, useAuthToken } from "@/lib/client-api";
import { usePermissoes } from "@/lib/permissoes";
import type { Plano, Veiculo } from "./tipos";

/**
 * O AVISO DO MOTORISTA no painel: cartão com fotos, urgência e as duas
 * decisões (abrir conserto / não precisa). Usado na caixa de entrada e no
 * histórico de avisos.
 */

export type Aviso = {
  id: string;
  descricao: string;
  avisadoEm: string;
  status: "ABERTO" | "VIROU_MANUTENCAO" | "DESCARTADO";
  fotos: number;
  podeRodar: "SIM" | "COM_CUIDADO" | "NAO" | null;
  lat: number | null;
  lng: number | null;
  motivoDescarte: string | null;
  decididoEm: string | null;
  manutencaoId: string | null;
  veiculo: Veiculo | null;
  motorista: { id: string; nome: string };
  decididoPor: { id: string; nome: string } | null;
};

/** Foto do aviso: vem da API com o token (o bucket não é público). */
export function FotoAviso({ id, indice }: { id: string; indice: number }) {
  const token = useAuthToken();
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "";
  const base = `${apiUrl}/admin/manutencao/problemas/${id}/fotos/${indice}`;
  const q = useQuery({
    queryKey: ["problema-foto", id, indice],
    enabled: Boolean(token),
    staleTime: Infinity,
    retry: false,
    queryFn: async () => {
      const res = await fetch(`${base}?mini=1`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return URL.createObjectURL(await res.blob());
    },
  });

  async function abrirGrande() {
    if (!token) return;
    const res = await fetch(base, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return;
    window.open(URL.createObjectURL(await res.blob()), "_blank", "noopener");
  }

  if (!q.data) {
    return <div className="h-20 w-20 animate-pulse rounded-md border bg-muted" />;
  }
  return (
    <button
      type="button"
      onClick={() => void abrirGrande()}
      className="h-20 w-20 overflow-hidden rounded-md border"
      title="Ver a foto inteira"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={q.data} alt={`Foto ${indice + 1} do aviso`} className="h-full w-full object-cover" />
    </button>
  );
}

/**
 * AVISOS DO MOTORISTA: o que ele mandou pelo app ("Avisar problema no
 * caminhão"). O escritório decide: vira manutenção aberta, ou não vira — com o
 * motivo escrito, pra ninguém reabrir no escuro.
 */
export function ListaAvisos() {
  const token = useAuthToken();
  const queryClient = useQueryClient();
  const [filtro, setFiltro] = React.useState<Aviso["status"]>("ABERTO");

  const lista = useQuery({
    queryKey: ["problemas-veiculo", filtro],
    enabled: Boolean(token),
    queryFn: () =>
      fetchApi<Aviso[]>(`/admin/manutencao/problemas?status=${filtro}`, { token: token! }),
  });

  async function atualizar() {
    await queryClient.invalidateQueries({ queryKey: ["problemas-veiculo"] });
    await queryClient.invalidateQueries({ queryKey: ["frota-alertas"] });
    await queryClient.invalidateQueries({ queryKey: ["manutencoes"] });
  }

  const itens = lista.data ?? [];

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        O que os motoristas mandaram pelo app, com foto. Cada aviso vira uma manutenção aberta
        ou fica registrado com o motivo de não virar.
      </p>
      <div className="max-w-xs">
        <Select
          aria-label="Quais avisos"
          value={filtro}
          onChange={(e) => setFiltro(e.target.value as Aviso["status"])}
        >
          <option value="ABERTO">Esperando decisão</option>
          <option value="VIROU_MANUTENCAO">Viraram manutenção</option>
          <option value="DESCARTADO">Não viraram manutenção</option>
        </Select>
      </div>

      {lista.isLoading && <LoadingCard />}
      {itens.length === 0 && !lista.isLoading && (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          {filtro === "ABERTO"
            ? "Nenhum aviso esperando. Quando um motorista avisar um problema pelo app, aparece aqui."
            : "Nada por aqui."}
        </Card>
      )}
      {itens.map((a) => (
        <CardAviso key={a.id} a={a} onMudou={() => void atualizar()} />
      ))}
    </div>
  );
}

export function SeloPodeRodar({ v }: { v: "SIM" | "COM_CUIDADO" | "NAO" }) {
  const cls =
    v === "NAO"
      ? "bg-red-100 text-red-700"
      : v === "COM_CUIDADO"
        ? "bg-amber-100 text-amber-800"
        : "bg-slate-100 text-slate-700";
  return <Badge className={`border-transparent ${cls}`}>{PODE_RODAR_LABEL[v]}</Badge>;
}

export function CardAviso({ a, onMudou }: { a: Aviso; onMudou: () => void }) {
  const token = useAuthToken();
  const [modo, setModo] = React.useState<"nada" | "abrir" | "descartar">("nada");
  const [veiculoId, setVeiculoId] = React.useState<string | undefined>(a.veiculo?.id);
  const [tipo, setTipo] = React.useState<TipoManutencaoTipo>("CORRETIVA");
  const [fornecedorId, setFornecedorId] = React.useState<string | undefined>(undefined);
  const [planoId, setPlanoId] = React.useState("");
  const [previstaEm, setPrevistaEm] = React.useState("");
  const [motivo, setMotivo] = React.useState("");
  const { temPermissao } = usePermissoes();
  // Os planos do caminhão: o conserto pode cumprir um deles (zera na conclusão).
  const planos = useQuery({
    queryKey: ["planos-manutencao"],
    enabled: Boolean(token) && modo === "abrir",
    queryFn: () => fetchApi<Plano[]>("/admin/manutencao/planos", { token: token! }),
  });
  const planosDoVeiculo = (planos.data ?? []).filter((p) => p.veiculo.id === veiculoId);
  const [erro, setErro] = React.useState<string | null>(null);
  const [enviando, setEnviando] = React.useState(false);

  async function abrir() {
    if (!token) return;
    if (!veiculoId) return setErro("Escolha o caminhão.");
    setErro(null);
    setEnviando(true);
    try {
      await fetchApi(`/admin/manutencao/problemas/${a.id}/abrir-manutencao`, {
        token,
        method: "POST",
        body: JSON.stringify({
          veiculoId,
          tipo,
          fornecedorId: fornecedorId ?? null,
          planoId: planoId || null,
          previstaEm: previstaEm || null,
        }),
      });
      onMudou();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  async function descartar() {
    if (!token) return;
    if (motivo.trim().length < 3) return setErro("Diga por que não vira manutenção.");
    setErro(null);
    setEnviando(true);
    try {
      await fetchApi(`/admin/manutencao/problemas/${a.id}/descartar`, {
        token,
        method: "POST",
        body: JSON.stringify({ motivo }),
      });
      onMudou();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">
            {a.veiculo ? (
              <Link href={`/veiculos/${a.veiculo.id}` as Route} className="hover:underline">
                {a.veiculo.placa}
              </Link>
            ) : (
              "Caminhão não informado"
            )}{" "}
            · {a.motorista.nome}
          </p>
          <p className="text-xs text-muted-foreground">
            avisou em {new Date(a.avisadoEm).toLocaleString("pt-BR")}
          </p>
        </div>
        {a.status === "ABERTO" && a.podeRodar && <SeloPodeRodar v={a.podeRodar} />}
        {a.status === "VIROU_MANUTENCAO" && (
          <Badge className="border-transparent bg-emerald-100 text-emerald-700">Virou manutenção</Badge>
        )}
        {a.status === "DESCARTADO" && (
          <Badge className="border-transparent bg-slate-100 text-slate-700">Não virou manutenção</Badge>
        )}
      </div>
      <p className="whitespace-pre-wrap text-sm">{a.descricao}</p>
      {a.lat != null && a.lng != null && (
        <a
          href={`https://www.google.com/maps?q=${a.lat},${a.lng}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block text-sm font-medium text-blue-700 underline-offset-2 hover:underline"
        >
          Ver no mapa onde o caminhão parou →
        </a>
      )}
      {a.fotos > 0 && (
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: a.fotos }, (_, i) => (
            <FotoAviso key={i} id={a.id} indice={i} />
          ))}
        </div>
      )}
      {a.status !== "ABERTO" && a.decididoPor && (
        <p className="text-xs text-muted-foreground">
          Decidido por {a.decididoPor.nome}
          {a.decididoEm && ` em ${new Date(a.decididoEm).toLocaleDateString("pt-BR")}`}
          {a.motivoDescarte && ` · motivo: ${a.motivoDescarte}`}
        </p>
      )}

      {a.status === "ABERTO" && modo === "nada" && (
        <div className="flex flex-wrap gap-2 border-t pt-3">
          <Permitido chave="manutencao.criar">
            <Button size="sm" onClick={() => setModo("abrir")}>
              Abrir conserto
            </Button>
          </Permitido>
          <Permitido chave="manutencao.editar">
            <Button size="sm" variant="outline" onClick={() => setModo("descartar")}>
              Não precisa
            </Button>
          </Permitido>
        </div>
      )}

      {modo === "abrir" && (
        <div className="space-y-3 border-t pt-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label>Caminhão</Label>
              <VeiculoCombobox
                triggerClassName="sm:w-full"
                value={veiculoId}
                initialOption={a.veiculo ? { value: a.veiculo.id, label: a.veiculo.placa } : undefined}
                onChange={(v) => {
                  setVeiculoId(v);
                  setPlanoId("");
                }}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`aviso-tipo-${a.id}`}>Tipo</Label>
              <Select
                id={`aviso-tipo-${a.id}`}
                value={tipo}
                onChange={(e) => setTipo(e.target.value as TipoManutencaoTipo)}
              >
                {TIPOS_MANUTENCAO.map((t) => (
                  <option key={t} value={t}>
                    {TIPO_MANUTENCAO_LABEL[t]}
                  </option>
                ))}
              </Select>
            </div>
            {temPermissao("fornecedores.ver") && (
              <div className="space-y-1">
                <Label>Oficina (opcional)</Label>
                <FornecedorCombobox
                  triggerClassName="sm:w-full"
                  value={fornecedorId}
                  onChange={setFornecedorId}
                />
              </div>
            )}
            <div className="space-y-1">
              <Label htmlFor={`aviso-prev-${a.id}`}>Previsto pra (opcional)</Label>
              <Input
                id={`aviso-prev-${a.id}`}
                type="date"
                value={previstaEm}
                onChange={(e) => setPrevistaEm(e.target.value)}
              />
            </div>
            {planosDoVeiculo.length > 0 && (
              <div className="space-y-1 md:col-span-2">
                <Label htmlFor={`aviso-plano-${a.id}`}>Cumpre alguma revisão programada?</Label>
                <Select
                  id={`aviso-plano-${a.id}`}
                  value={planoId}
                  onChange={(e) => setPlanoId(e.target.value)}
                >
                  <option value="">Não</option>
                  {planosDoVeiculo.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.descricao}
                    </option>
                  ))}
                </Select>
              </div>
            )}
          </div>
          {erro && <p className="text-sm text-destructive">{erro}</p>}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => setModo("nada")} disabled={enviando}>
              Voltar
            </Button>
            <Button size="sm" onClick={() => void abrir()} disabled={enviando}>
              Abrir conserto
            </Button>
          </div>
        </div>
      )}

      {modo === "descartar" && (
        <div className="space-y-3 border-t pt-3">
          <div className="space-y-1">
            <Label htmlFor={`aviso-motivo-${a.id}`}>Por que não vira manutenção</Label>
            <Input
              id={`aviso-motivo-${a.id}`}
              placeholder="ex: Já resolvido na última revisão"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
            />
          </div>
          {erro && <p className="text-sm text-destructive">{erro}</p>}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => setModo("nada")} disabled={enviando}>
              Voltar
            </Button>
            <Button size="sm" variant="warning" onClick={() => void descartar()} disabled={enviando}>
              Registrar que não vira
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

