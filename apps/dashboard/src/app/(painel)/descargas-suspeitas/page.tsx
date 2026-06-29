"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowRight, ExternalLink, MapPin, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { fetchApi, useAuthToken } from "@/lib/client-api";

type LocalRef = {
  id: string;
  nome: string;
  cidade: string;
  uf: string;
  distanciaMetros: number | null;
};

type Suspeita = {
  viagemId: string;
  ticket: string;
  data: string;
  motorista: { id: string; nome: string } | null;
  bloqueada: boolean;
  lat: number | null;
  lng: number | null;
  tipo: "COM_SUGESTAO" | "SEM_LOCAL";
  localAtual: LocalRef | null;
  sugestao: LocalRef | null;
};

type Resposta = {
  raioInicialM: number;
  raioAmpliadoM: number;
  total: number;
  itens: Suspeita[];
};

const PATH = "/admin/viagens/descargas-suspeitas";

// data vem de viagem.data (@db.Date = meia-noite UTC): exibir em UTC, senão
// no Brasil (UTC-3) volta um dia.
function fmtData(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getUTCFullYear()}`;
}

function fmtDist(m: number | null): string {
  return m == null ? "sem coordenadas" : `${m}m do GPS`;
}

function LinhaCabecalho({ s }: { s: Suspeita }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="font-semibold">Ticket {s.ticket}</span>
      <span className="text-muted-foreground">· {fmtData(s.data)}</span>
      {s.motorista && <span className="text-muted-foreground">· {s.motorista.nome}</span>}
      {s.bloqueada && (
        <Badge className="border-amber-400 text-amber-600">No fechamento</Badge>
      )}
    </div>
  );
}

function LocalAtual({ s }: { s: Suspeita }) {
  return (
    <div className="flex items-center gap-1.5 text-sm">
      <MapPin className="h-4 w-4 text-destructive" />
      <span>
        <span className="text-muted-foreground">Atual:</span>{" "}
        <span className="font-medium">{s.localAtual ? s.localAtual.nome : "—"}</span>
        {s.localAtual && (
          <span className="text-muted-foreground">
            {" "}
            ({s.localAtual.cidade}/{s.localAtual.uf}) · {fmtDist(s.localAtual.distanciaMetros)}
          </span>
        )}
      </span>
    </div>
  );
}

export default function DescargasSuspeitasPage() {
  const token = useAuthToken();
  const qc = useQueryClient();
  const [ignorados, setIgnorados] = useState<Set<string>>(new Set());
  const [nomes, setNomes] = useState<Record<string, string>>({});

  const lista = useQuery({
    queryKey: [PATH, token],
    enabled: !!token,
    queryFn: () => fetchApi<Resposta>(PATH, { token }),
  });

  const corrigir = useMutation({
    mutationFn: (v: { viagemId: string; localDescargaId: string }) =>
      fetchApi(`/admin/viagens/${v.viagemId}`, {
        method: "PATCH",
        body: JSON.stringify({ localDescargaId: v.localDescargaId }),
        token,
      }),
    onSuccess: (_data, v) => {
      toast.success("Local de descarga corrigido.");
      ocultar(v.viagemId);
      void qc.invalidateQueries({ queryKey: [PATH] });
    },
    onError: (err) => {
      toast.error("Não foi possível corrigir", { description: (err as Error).message });
    },
  });

  const cadastrar = useMutation({
    mutationFn: (v: { viagemId: string; nome: string }) =>
      fetchApi(`/admin/viagens/descargas-suspeitas/${v.viagemId}/cadastrar-local`, {
        method: "POST",
        body: JSON.stringify({ nome: v.nome }),
        token,
      }),
    onSuccess: (_data, v) => {
      toast.success("Local cadastrado e atribuído à viagem.");
      ocultar(v.viagemId);
      void qc.invalidateQueries({ queryKey: [PATH] });
    },
    onError: (err) => {
      toast.error("Não foi possível cadastrar", { description: (err as Error).message });
    },
  });

  function ocultar(viagemId: string) {
    setIgnorados((s) => new Set(s).add(viagemId));
  }

  const visiveis = (lista.data?.itens ?? []).filter((i) => !ignorados.has(i.viagemId));
  const comSugestao = visiveis.filter((i) => i.tipo === "COM_SUGESTAO");
  const semLocal = visiveis.filter((i) => i.tipo === "SEM_LOCAL");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Revisar descargas suspeitas</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Viagens onde o GPS do motorista no lançamento ficou longe do local de
          descarga escolhido — provável engano do raio de busca antigo (maior). A
          busca confere {lista.data?.raioInicialM ?? 50}m e depois{" "}
          {lista.data?.raioAmpliadoM ?? 500}m. Confira e resolva uma a uma; nada
          muda sem você clicar.
        </p>
      </div>

      {lista.isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
      {lista.isError && (
        <p className="text-sm text-destructive">
          Erro ao carregar: {(lista.error as Error).message}
        </p>
      )}

      {lista.data && visiveis.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Nenhuma descarga suspeita no momento. 🎉
        </p>
      )}

      {/* CASO A: existe um local melhor pra sugerir */}
      {comSugestao.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground">
            Com sugestão · {comSugestao.length}
          </h2>
          {comSugestao.map((s) => (
            <Card key={s.viagemId} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-2">
                  <LinhaCabecalho s={s} />
                  <div className="flex flex-wrap items-center gap-2">
                    <LocalAtual s={s} />
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                    <div className="flex items-center gap-1.5 text-sm">
                      <MapPin className="h-4 w-4 text-success" />
                      <span>
                        <span className="text-muted-foreground">Sugerido:</span>{" "}
                        <span className="font-medium">{s.sugestao?.nome}</span>
                        <span className="text-muted-foreground">
                          {" "}
                          ({s.sugestao?.cidade}/{s.sugestao?.uf}) ·{" "}
                          {fmtDist(s.sugestao?.distanciaMetros ?? null)}
                        </span>
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Link href={`/viagens/${s.viagemId}`} target="_blank">
                    <Button variant="ghost" size="sm">
                      <ExternalLink className="mr-1.5 h-4 w-4" />
                      Abrir
                    </Button>
                  </Link>
                  <Button variant="ghost" size="sm" onClick={() => ocultar(s.viagemId)}>
                    Ignorar
                  </Button>
                  <Button
                    size="sm"
                    disabled={s.bloqueada || corrigir.isPending}
                    onClick={() =>
                      s.sugestao &&
                      corrigir.mutate({ viagemId: s.viagemId, localDescargaId: s.sugestao.id })
                    }
                    title={
                      s.bloqueada
                        ? "Viagem já vinculada a fechamento — desfaça o match primeiro"
                        : undefined
                    }
                  >
                    Trocar p/ sugerido
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </section>
      )}

      {/* CASO B: não há local cadastrado por perto — cadastrar na hora */}
      {semLocal.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground">
            Sem local cadastrado por perto · {semLocal.length}
          </h2>
          <p className="max-w-3xl text-xs text-muted-foreground">
            O GPS dessas viagens não tem nenhum local de descarga cadastrado nem
            dentro de {lista.data?.raioAmpliadoM ?? 500}m. Dê um nome ao lugar — ele
            é criado no GPS da viagem (endereço preenchido automaticamente) e já fica
            atribuído.
          </p>
          {semLocal.map((s) => (
            <Card key={s.viagemId} className="space-y-3 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-2">
                  <LinhaCabecalho s={s} />
                  <LocalAtual s={s} />
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Link href={`/viagens/${s.viagemId}`} target="_blank">
                    <Button variant="ghost" size="sm">
                      <ExternalLink className="mr-1.5 h-4 w-4" />
                      Abrir
                    </Button>
                  </Link>
                  <Button variant="ghost" size="sm" onClick={() => ocultar(s.viagemId)}>
                    Ignorar
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  placeholder='Nome do lugar (ex: "Obra do shopping")'
                  value={nomes[s.viagemId] ?? ""}
                  onChange={(e) =>
                    setNomes((n) => ({ ...n, [s.viagemId]: e.target.value }))
                  }
                  maxLength={120}
                  disabled={s.bloqueada}
                  className="max-w-sm"
                />
                <Button
                  size="sm"
                  disabled={
                    s.bloqueada ||
                    cadastrar.isPending ||
                    (nomes[s.viagemId]?.trim().length ?? 0) < 2
                  }
                  onClick={() =>
                    cadastrar.mutate({
                      viagemId: s.viagemId,
                      nome: (nomes[s.viagemId] ?? "").trim(),
                    })
                  }
                  title={
                    s.bloqueada
                      ? "Viagem já vinculada a fechamento — desfaça o match primeiro"
                      : undefined
                  }
                >
                  <Plus className="mr-1.5 h-4 w-4" />
                  Cadastrar e atribuir
                </Button>
              </div>
            </Card>
          ))}
        </section>
      )}
    </div>
  );
}
