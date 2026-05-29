"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { use, useState } from "react";
import { ExcluirButton } from "@/components/excluir-button";

// Leaflet quebra com SSR; carrega só no cliente.
const TrajetoMapPlayer = dynamic(
  () =>
    import("@/components/trajeto-map-player").then((m) => m.TrajetoMapPlayer),
  { ssr: false, loading: () => <div className="h-80 rounded-lg border bg-muted/30" /> },
);
const MapaTrajetoViagem = dynamic(
  () =>
    import("@/components/mapa-trajeto-viagem").then((m) => m.MapaTrajetoViagem),
  { ssr: false, loading: () => <div className="h-72 rounded-md border bg-muted/30" /> },
);
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Camera,
  CheckCircle2,
  Clock,
  Edit3,
  ExternalLink,
  History,
  ImageOff,
  MapPin,
  RefreshCw,
  RotateCw,
  ShieldCheck,
  Sparkles,
  ThumbsUp,
  ThumbsDown,
  User as UserIcon,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { fetchApi, useAuthToken } from "@/lib/client-api";
import {
  fmtBR,
  fmtBRL,
  fmtDataHoraBR,
  fmtNum,
} from "@/lib/fechamento-helpers";
import { ValorComMinimo } from "@/components/valor-com-minimo";
import { useHistoricoViagem } from "@/lib/fechamentos-api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DiagnosticoViagem } from "./_components/diagnostico-viagem";

type ViagemDetalhe = {
  id: string;
  data: string;
  toneladas: string;
  ticket: string;
  km: string;
  kmReal: string | null;
  kmCalculado: string | null;
  toneladasInformada: string;
  toneladasEfetiva: string;
  toneladasAjustada: boolean;
  kmInformado: string;
  kmEfetivo: string;
  kmAjustada: boolean;
  iniciadoEm: string | null;
  pontos: {
    lat: number;
    lng: number;
    capturadoEm: string;
    velocidade?: number | null;
    precisao?: number | null;
  }[];
  status: string;
  observacao: string | null;
  valorPedagioTotal: string | null;
  lat: number | null;
  lng: number | null;
  veiculo: { id: string; placa: string; modelo: string | null };
  motorista: { id: string; nome: string; cpf: string };
  cliente: { id: string; nome: string; empresa: { nome: string } };
  material: { id: string; nome: string };
  localCarga: {
    nome: string;
    cidade: string;
    uf: string;
    logradouro: string;
    lat: number | null;
    lng: number | null;
  };
  localDescarga: {
    nome: string;
    cidade: string;
    uf: string;
    logradouro: string;
    lat: number | null;
    lng: number | null;
  };
  rotaGeometria: string | null;
  revisadoEm: string | null;
  revisadoPor: { id: string; nome: string } | null;
  motivoStatus: string | null;
  ocrCampos: string[];
  ocrConfidence: number | null;
  fotos: { id: string; storageKey: string; rotacao: number }[];
  matchesFechamento: Array<{
    id: string;
    fechamento: {
      id: string;
      versao: number;
      periodoInicio: string;
      periodoFim: string;
      empresa: { nome: string };
    };
  }>;
};

type Tab = "dados" | "historico" | "diagnostico";

export default function ViagemDetalhePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const token = useAuthToken();
  const viagem = useQuery({
    queryKey: ["viagem-admin", id],
    enabled: !!token,
    queryFn: () => fetchApi<ViagemDetalhe>(`/admin/viagens/${id}`, { token }),
  });
  const historico = useHistoricoViagem(id);
  const queryClient = useQueryClient();
  const recalcular = useMutation({
    mutationFn: () =>
      fetchApi<{ ok: true }>(`/admin/viagens/${id}/recalcular-trajeto`, {
        method: "POST",
        token,
      }),
    onSuccess: () => {
      toast.success("Trajeto recalculado.");
      void queryClient.invalidateQueries({ queryKey: ["viagem-admin", id] });
      void queryClient.invalidateQueries({ queryKey: ["viagem-historico", id] });
    },
    onError: (err) => {
      toast.error("Não foi possível recalcular", {
        description: (err as Error).message,
      });
    },
  });
  const preValidar = useMutation({
    mutationFn: (body: { status: "OK" | "DIVERGENTE" | "DESFAZER"; motivo?: string }) =>
      fetchApi<{ ok: true }>(`/admin/viagens/${id}/pre-validar`, {
        method: "POST",
        body: JSON.stringify(body),
        token,
      }),
    onSuccess: () => {
      toast.success("Pré-validação registrada.");
      void queryClient.invalidateQueries({ queryKey: ["viagem-admin", id] });
      void queryClient.invalidateQueries({ queryKey: ["viagem-historico", id] });
    },
    onError: (err) => {
      toast.error("Não foi possível pré-validar", {
        description: (err as Error).message,
      });
    },
  });
  const [tab, setTab] = useState<Tab>("dados");
  const [dialogDivergente, setDialogDivergente] = useState(false);
  const [motivoTexto, setMotivoTexto] = useState("");

  if (viagem.isLoading) return <p className="text-sm text-muted-foreground">Carregando...</p>;
  if (!viagem.data) return <p className="text-sm text-red-600">Viagem não encontrada.</p>;
  const v = viagem.data;
  const emFechamento = v.matchesFechamento.length > 0;

  return (
    <div className="space-y-6">
      <header className="flex items-start gap-3">
        <Link href="/viagens">
          <span className="rounded p-2 hover:bg-muted">
            <ArrowLeft className="h-5 w-5" />
          </span>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              Viagem {v.ticket}
            </h1>
            <Badge>{v.status}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {v.motorista.nome} · placa <span className="font-mono">{v.veiculo.placa}</span> ·{" "}
            {fmtBR(v.data)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {v.matchesFechamento.length === 0 ? (
            <Link href={`/viagens/${v.id}/editar`}>
              <Button variant="outline" size="sm">
                <Edit3 className="h-4 w-4" />
                Editar
              </Button>
            </Link>
          ) : (
            <Button
              variant="outline"
              size="sm"
              disabled
              title="Viagem em fechamento — desfaça o match antes de editar"
            >
              <Edit3 className="h-4 w-4" />
              Editar
            </Button>
          )}
          <ExcluirButton
            path="/admin/viagens"
            id={v.id}
            nomeRecurso={`a viagem ${v.ticket}`}
            size="sm"
            variant="outline"
            label="Excluir"
            invalidateKeys={[["viagem-admin", v.id], "/admin/viagens"]}
            onSuccess={() => router.push("/viagens")}
          />
        </div>
      </header>

      <div className="flex gap-1 border-b">
        {(
          [
            ["dados", "Dados"],
            ["historico", "Histórico de alterações"],
            ["diagnostico", "Diagnóstico"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm transition-colors ${
              tab === key
                ? "border-blue-600 font-medium text-blue-700"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "dados" && (
        <div className="grid gap-4 md:grid-cols-2 md:auto-rows-min">
          <Card className="p-5">
            <h3 className="mb-3 text-base font-medium">Dados do lançamento</h3>
            <dl className="space-y-2 text-sm">
              <Row
                label="Material"
                value={v.material.nome}
                fromAi={v.ocrCampos?.includes("materialId")}
              />
              <Row
                label="Cliente"
                value={v.cliente.nome}
                fromAi={v.ocrCampos?.includes("clienteId")}
              />
              <Row label="Empresa" value={v.cliente.empresa.nome} />
              <Row
                label="Toneladas"
                fromAi={v.ocrCampos?.includes("toneladas")}
                value={
                  <ValorComMinimo
                    efetivo={v.toneladasEfetiva}
                    real={v.toneladasInformada}
                    ajustada={v.toneladasAjustada}
                    unidade="t"
                    casas={3}
                  />
                }
              />
              <Row
                label="Km rodados"
                fromAi={v.ocrCampos?.includes("km")}
                value={
                  <span>
                    <ValorComMinimo
                      efetivo={v.kmEfetivo}
                      real={v.kmInformado}
                      ajustada={v.kmAjustada}
                      unidade="km"
                      casas={2}
                    />
                    {v.kmCalculado &&
                      Number(v.kmCalculado) !== Number(v.km) && (
                        <span className="ml-1 text-xs text-muted-foreground">
                          (calculado: {fmtNum(v.kmCalculado, 2)})
                        </span>
                      )}
                  </span>
                }
              />
              {v.kmReal && (
                <Row label="Km real (GPS)" value={fmtNum(v.kmReal, 2)} />
              )}
              <Row
                label="Ticket"
                value={v.ticket}
                mono
                fromAi={v.ocrCampos?.includes("ticket")}
              />
              {v.valorPedagioTotal && <Row label="Pedágio" value={fmtBRL(v.valorPedagioTotal)} />}
              {v.observacao && <Row label="Observação" value={v.observacao} />}
            </dl>
          </Card>

          {/* Fotos do ticket: na coluna direita pra ficar lado a lado com
              os dados — admin confere foto + valores sem rolar. row-span-2
              estende ela embaixo do Trajeto textual também. */}
          <Card className="p-5 md:row-span-2">
            <h3 className="mb-3 flex items-center gap-2 text-base font-medium">
              <Camera className="h-4 w-4" /> Fotos do ticket
            </h3>
            {v.fotos.length === 0 && (
              <p className="mb-2 text-sm text-muted-foreground">
                Nenhuma foto anexada pelo motorista.
              </p>
            )}
            <FotosViagem viagemId={v.id} fotos={v.fotos} />
          </Card>

          <Card className="p-5">
            <h3 className="mb-3 text-base font-medium">Trajeto</h3>
            <div className="space-y-3 text-sm">
              <div>
                <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <ArrowUp className="h-3.5 w-3.5" /> Carga
                </div>
                <p className="mt-0.5 font-medium">{v.localCarga.nome}</p>
                <p className="text-xs text-muted-foreground">
                  {v.localCarga.logradouro} — {v.localCarga.cidade}/{v.localCarga.uf}
                </p>
              </div>
              <div>
                <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <ArrowDown className="h-3.5 w-3.5" /> Descarga
                </div>
                <p className="mt-0.5 font-medium">{v.localDescarga.nome}</p>
                <p className="text-xs text-muted-foreground">
                  {v.localDescarga.logradouro} — {v.localDescarga.cidade}/{v.localDescarga.uf}
                </p>
              </div>
            </div>
          </Card>

          {v.pontos && v.pontos.length >= 2 && (
            <Card className="p-5 md:col-span-2">
              <h3 className="mb-3 flex items-center gap-2 text-base font-medium">
                <MapPin className="h-4 w-4" /> Trajeto capturado por GPS
              </h3>
              <TrajetoMapPlayer pontos={v.pontos} />
              <p className="mt-2 text-xs text-muted-foreground">
                {v.pontos.length} pontos · capturado entre{" "}
                {v.iniciadoEm ? fmtDataHoraBR(v.iniciadoEm) : "?"} e{" "}
                {fmtDataHoraBR(v.pontos[v.pontos.length - 1]!.capturadoEm)}
              </p>
            </Card>
          )}

          {(v.localCarga.lat != null ||
            v.localDescarga.lat != null ||
            v.lat != null) && (
            <Card className="p-5 md:col-span-2">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="flex items-center gap-2 text-base font-medium">
                  <MapPin className="h-4 w-4" /> Trajeto da viagem
                </h3>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => recalcular.mutate()}
                  disabled={recalcular.isPending}
                  title="Reprocessa o trajeto via OSRM (atualiza polilinha e km de cache)"
                >
                  <RefreshCw
                    className={`h-4 w-4 ${recalcular.isPending ? "animate-spin" : ""}`}
                  />
                  {recalcular.isPending ? "Recalculando…" : "Recalcular trajeto"}
                </Button>
              </div>
              <MapaTrajetoViagem
                carga={
                  v.localCarga.lat != null && v.localCarga.lng != null
                    ? { lat: v.localCarga.lat, lng: v.localCarga.lng, nome: v.localCarga.nome }
                    : null
                }
                descarga={
                  v.localDescarga.lat != null && v.localDescarga.lng != null
                    ? {
                        lat: v.localDescarga.lat,
                        lng: v.localDescarga.lng,
                        nome: v.localDescarga.nome,
                      }
                    : null
                }
                lancamento={
                  v.lat != null && v.lng != null ? { lat: v.lat, lng: v.lng } : null
                }
                geometria={v.rotaGeometria}
              />
            </Card>
          )}

          <Card className="p-5 md:col-span-2">
            <h3 className="mb-3 flex items-center gap-2 text-base font-medium">
              <ShieldCheck className="h-4 w-4" /> Pré-validação
            </h3>
            {v.revisadoEm ? (
              <div className="space-y-2">
                <p className="text-sm">
                  <Badge
                    className={
                      v.status === "OK"
                        ? "bg-green-100 text-green-800 border-green-200"
                        : "bg-red-100 text-red-800 border-red-200"
                    }
                  >
                    {v.status === "OK" ? "Validada" : "Divergente"}
                  </Badge>
                  <span className="ml-2 text-muted-foreground">
                    por {v.revisadoPor?.nome ?? "—"} em {fmtDataHoraBR(v.revisadoEm)}
                  </span>
                </p>
                {v.motivoStatus && (
                  <p className="rounded-md border bg-muted/30 p-3 text-sm">
                    <span className="font-medium">Motivo:</span> {v.motivoStatus}
                  </p>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => preValidar.mutate({ status: "DESFAZER" })}
                  disabled={preValidar.isPending}
                >
                  Desfazer pré-validação
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  Marque como validada ou divergente antes do fechamento.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    onClick={() => preValidar.mutate({ status: "OK" })}
                    disabled={preValidar.isPending || emFechamento}
                    title={
                      emFechamento
                        ? "Viagem em fechamento — desfaça o match antes de pré-validar"
                        : undefined
                    }
                    className="border-green-300 bg-green-50 text-green-900 hover:bg-green-100"
                  >
                    <ThumbsUp className="h-4 w-4" /> Marcar como validada
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setMotivoTexto("");
                      setDialogDivergente(true);
                    }}
                    disabled={preValidar.isPending || emFechamento}
                    title={
                      emFechamento
                        ? "Viagem em fechamento — desfaça o match antes de pré-validar"
                        : undefined
                    }
                    className="border-red-300 bg-red-50 text-red-900 hover:bg-red-100"
                  >
                    <ThumbsDown className="h-4 w-4" /> Marcar como divergente
                  </Button>
                </div>
              </div>
            )}
          </Card>

          {v.matchesFechamento.length > 0 && (
            <Card className="p-5 md:col-span-2">
              <h3 className="mb-3 text-base font-medium">Aparece em fechamentos</h3>
              <ul className="space-y-2 text-sm">
                {v.matchesFechamento.map((m) => (
                  <li key={m.id} className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                    <Link
                      href={`/fechamentos/${m.fechamento.id}`}
                      className="text-blue-600 hover:underline"
                    >
                      {m.fechamento.empresa.nome} — {fmtBR(m.fechamento.periodoInicio)} a{" "}
                      {fmtBR(m.fechamento.periodoFim)} (v{m.fechamento.versao})
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}

      {tab === "historico" && (
        <Card className="p-5">
          <h3 className="mb-4 text-base font-medium">
            <History className="mr-2 inline h-4 w-4" />
            Linha do tempo
          </h3>
          {historico.isLoading && <p className="text-sm">Carregando...</p>}
          {historico.data?.length === 0 && (
            <p className="text-sm text-muted-foreground">Sem eventos ainda.</p>
          )}
          <ol className="relative space-y-4 border-l border-border pl-6">
            {historico.data?.map((ev) => {
              const Icon = iconForAcao(ev.acao);
              return (
                <li key={ev.id} className="relative">
                  <span
                    className={`absolute -left-[27px] top-1.5 flex h-5 w-5 items-center justify-center rounded-full border-2 border-background ${colorForAcao(ev.acao)}`}
                  >
                    <Icon className="h-3 w-3 text-white" />
                  </span>
                  <div className="rounded-md border bg-background p-3">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-medium">{labelForAcao(ev.acao)}</span>
                      {ev.campo && (
                        <Badge className="border-slate-200 bg-slate-50 text-slate-700">
                          {labelForCampo(ev.campo)}
                        </Badge>
                      )}
                      <span className="ml-auto text-xs text-muted-foreground">
                        {fmtDataHoraBR(ev.criadoEm)}
                      </span>
                    </div>
                    {(ev.usuario?.nome ??
                      (ev.metadata as { motoristaNome?: string } | null)
                        ?.motoristaNome) && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        <UserIcon className="mr-1 inline h-3 w-3" />
                        {ev.usuario?.nome ??
                          (
                            ev.metadata as { motoristaNome?: string } | null
                          )?.motoristaNome}
                      </p>
                    )}
                    {ev.motivo && <p className="mt-2 text-sm">{ev.motivo}</p>}
                    {(ev.valorAntes !== null || ev.valorDepois !== null) && (
                      <div className="mt-2 grid gap-2 text-xs md:grid-cols-2">
                        {ev.valorAntes !== null && ev.valorAntes !== undefined && (
                          <div className="rounded bg-red-50 p-2 text-red-900">
                            <p className="font-medium">Antes</p>
                            <pre className="whitespace-pre-wrap break-words font-mono">
                              {formatVal(ev.valorAntes)}
                            </pre>
                          </div>
                        )}
                        {ev.valorDepois !== null && ev.valorDepois !== undefined && (
                          <div className="rounded bg-green-50 p-2 text-green-900">
                            <p className="font-medium">Depois</p>
                            <pre className="whitespace-pre-wrap break-words font-mono">
                              {formatVal(ev.valorDepois)}
                            </pre>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </Card>
      )}

      {tab === "diagnostico" && <DiagnosticoViagem viagemId={v.id} />}

      <Dialog open={dialogDivergente} onOpenChange={setDialogDivergente}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Marcar viagem como divergente</DialogTitle>
            <DialogDescription>
              Descreva o motivo da divergência (mínimo 2 caracteres).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Motivo</Label>
            <Textarea
              autoFocus
              rows={4}
              value={motivoTexto}
              onChange={(e) => setMotivoTexto(e.target.value)}
              placeholder="Ex: Toneladas não conferem com ticket fotografado"
              maxLength={500}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogDivergente(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => {
                preValidar.mutate(
                  { status: "DIVERGENTE", motivo: motivoTexto.trim() },
                  {
                    onSuccess: () => {
                      setDialogDivergente(false);
                      setMotivoTexto("");
                    },
                  },
                );
              }}
              disabled={
                motivoTexto.trim().length < 2 || preValidar.isPending
              }
            >
              Confirmar divergência
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Row({
  label,
  value,
  mono,
  fromAi,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  fromAi?: boolean;
}) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">
        {label}
        {fromAi && (
          <span
            className="ml-1 text-xs text-indigo-600"
            title="Preenchido pela IA"
          >
            ✨
          </span>
        )}
      </dt>
      <dd className={mono ? "font-mono" : ""}>{value}</dd>
    </div>
  );
}

function labelForAcao(acao: string): string {
  return (
    {
      UPDATE: "Atualização",
      DELETE: "Remoção",
      RESOLVER: "Resolução manual",
      SUBSTITUIR: "Substituição",
      EXPORTAR: "Exportação",
      MARCAR_ENVIADO: "Marcado como enviado",
      MATCH_AUTOMATICO: "Match automático",
      MATCH_IA: "Match via IA",
      RECALCULAR_TRAJETO: "Recálculo de trajeto",
      MOTORISTA_AJUSTOU_KM: "Motorista ajustou o km",
      PRE_VALIDAR_VIAGEM: "Pré-validação manual",
    } as const
  )[acao as never] ?? acao;
}

function iconForAcao(acao: string) {
  if (acao === "MATCH_IA") return Sparkles;
  if (acao === "MATCH_AUTOMATICO" || acao === "RESOLVER") return CheckCircle2;
  if (acao === "UPDATE" || acao === "MOTORISTA_AJUSTOU_KM") return Edit3;
  if (acao === "RECALCULAR_TRAJETO") return RefreshCw;
  if (acao === "PRE_VALIDAR_VIAGEM") return ShieldCheck;
  return Clock;
}

function colorForAcao(acao: string): string {
  if (acao === "MATCH_IA") return "bg-emerald-500";
  if (acao === "MATCH_AUTOMATICO") return "bg-green-500";
  if (acao === "RESOLVER") return "bg-blue-500";
  if (acao === "UPDATE") return "bg-orange-500";
  if (acao === "EXPORTAR" || acao === "MARCAR_ENVIADO") return "bg-purple-500";
  if (acao === "RECALCULAR_TRAJETO") return "bg-cyan-500";
  if (acao === "MOTORISTA_AJUSTOU_KM") return "bg-amber-500";
  if (acao === "PRE_VALIDAR_VIAGEM") return "bg-indigo-500";
  return "bg-gray-500";
}

function formatVal(v: unknown): string {
  if (v === null || v === undefined) return "—";
  // FK enriquecida pelo backend: { id, nome } — mostra só o nome
  if (
    typeof v === "object" &&
    v !== null &&
    "nome" in v &&
    typeof (v as { nome: unknown }).nome === "string"
  ) {
    return (v as { nome: string }).nome;
  }
  if (typeof v === "string") {
    // Data ISO (YYYY-MM-DD ou ISO completo) → formato BR
    if (/^\d{4}-\d{2}-\d{2}/.test(v)) {
      const formatted = fmtBR(v);
      if (formatted !== "—") return formatted;
    }
    return v;
  }
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v, null, 2);
}

const CAMPO_LABEL: Record<string, string> = {
  toneladas: "Toneladas",
  km: "Km",
  ticket: "Ticket",
  data: "Data",
  observacao: "Observação",
  valorPedagioTotal: "Pedágio",
  veiculoId: "Veículo",
  clienteId: "Cliente",
  materialId: "Material",
  localCargaId: "Local de carga",
  localDescargaId: "Local de descarga",
};

function labelForCampo(campo: string): string {
  return CAMPO_LABEL[campo] ?? campo;
}

function FotosViagem({
  viagemId,
  fotos,
}: {
  viagemId: string;
  fotos: { id: string; storageKey: string; rotacao: number }[];
}) {
  const token = useAuthToken();
  const qc = useQueryClient();
  const [zoom, setZoom] = useState<{ url: string; rotacao: number } | null>(null);

  const rotacionar = useMutation({
    mutationFn: (params: { fotoId: string; rotacao: number }) =>
      fetchApi(`/admin/viagens/${viagemId}/fotos/${params.fotoId}`, {
        method: "PATCH",
        body: JSON.stringify({ rotacao: params.rotacao }),
        token,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["viagem-admin", viagemId] });
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const adicionar = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append("foto", file);
      return fetchApi(`/admin/viagens/${viagemId}/fotos`, {
        method: "POST",
        body: fd,
        token,
      });
    },
    onSuccess: () => {
      toast.success("Foto anexada.");
      void qc.invalidateQueries({ queryKey: ["viagem-admin", viagemId] });
      void qc.invalidateQueries({ queryKey: ["viagem-historico", viagemId] });
    },
    onError: (err) => toast.error("Falha ao anexar", { description: (err as Error).message }),
  });

  function onPickFile(ev: React.ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0];
    ev.target.value = "";
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Foto maior que 10MB");
      return;
    }
    adicionar.mutate(file);
  }

  return (
    <>
      {/* 1 coluna em telas md+ (a Card já fica numa coluna do grid externo,
          então 1-col aqui maximiza tamanho da foto pra conferência). */}
      <div className="grid grid-cols-1 gap-3">
        {fotos.map((f) => (
          <FotoThumb
            key={f.id}
            viagemId={viagemId}
            fotoId={f.id}
            rotacao={f.rotacao}
            token={token}
            onClick={(url) => setZoom({ url, rotacao: f.rotacao })}
            onRotacionar={() =>
              rotacionar.mutate({
                fotoId: f.id,
                rotacao: (f.rotacao + 90) % 360,
              })
            }
          />
        ))}
      </div>

      <div className="mt-3">
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-muted">
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={onPickFile}
            disabled={adicionar.isPending}
          />
          {adicionar.isPending ? "Enviando…" : "+ Anexar foto"}
        </label>
      </div>

      {zoom && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setZoom(null)}
        >
          <button
            type="button"
            className="absolute right-4 top-4 rounded-full bg-white/20 p-2 text-white hover:bg-white/30"
            onClick={(e) => { e.stopPropagation(); setZoom(null); }}
          >
            <X className="h-5 w-5" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={zoom.url}
            alt="Foto do ticket"
            className="max-h-full max-w-full object-contain"
            style={{ transform: `rotate(${zoom.rotacao}deg)` }}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}

function FotoThumb({
  viagemId,
  fotoId,
  rotacao,
  token,
  onClick,
  onRotacionar,
}: {
  viagemId: string;
  fotoId: string;
  rotacao: number;
  token: string | undefined;
  onClick: (url: string) => void;
  onRotacionar: () => void;
}) {
  const q = useQuery({
    queryKey: ["viagem-foto-blob", viagemId, fotoId],
    enabled: !!token,
    staleTime: 30 * 60_000,
    gcTime: 10 * 60_000,
    retry: false,
    queryFn: async () => {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "";
      const res = await fetch(`${apiUrl}/admin/viagens/${viagemId}/fotos/${fotoId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      return URL.createObjectURL(blob);
    },
  });

  // Não revoga o blob URL no unmount: TanStack Query cacheia o valor (staleTime 30min)
  // e ao voltar pra esta tab depois de mudar pra outra, o componente remonta usando o
  // mesmo URL do cache. Revogar quebra a imagem ao retornar. Browser limpa ao fechar
  // a página (overhead desprezível).

  if (q.error instanceof Error && q.error.message.includes("404")) {
    return (
      <div className="flex h-80 flex-col items-center justify-center gap-1 rounded-md border border-dashed bg-muted/30 text-xs text-muted-foreground">
        <ImageOff className="h-7 w-7 opacity-40" />
        <span>Foto indisponível</span>
      </div>
    );
  }

  if (q.isLoading || !q.data) {
    return (
      <div className="flex h-80 items-center justify-center rounded-md border bg-muted text-xs text-muted-foreground">
        carregando...
      </div>
    );
  }

  return (
    <FotoThumbInner
      src={q.data}
      rotacao={rotacao}
      onClick={() => onClick(q.data!)}
      onRotacionar={onRotacionar}
    />
  );
}

function FotoThumbInner({
  src,
  rotacao,
  onClick,
  onRotacionar,
}: {
  src: string;
  rotacao: number;
  onClick: () => void;
  onRotacionar: () => void;
}) {
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null);

  function onMove(e: React.MouseEvent<HTMLElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    setOrigin({ x, y });
  }

  return (
    <div className="relative h-80 overflow-hidden rounded-md border bg-muted">
      <button
        type="button"
        onClick={onClick}
        onMouseMove={onMove}
        onMouseLeave={() => setOrigin(null)}
        className="group absolute inset-0 cursor-zoom-in"
        title="Ampliar"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt="Ticket"
          className="h-full w-full object-contain transition-transform duration-150 ease-out"
          style={{
            transform: origin
              ? `rotate(${rotacao}deg) scale(2.5)`
              : `rotate(${rotacao}deg)`,
            transformOrigin: origin ? `${origin.x}% ${origin.y}%` : "center",
          }}
        />
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onRotacionar();
        }}
        className="absolute right-1 top-1 z-10 rounded-md bg-black/60 p-1.5 text-white shadow hover:bg-black/80"
        title="Rotacionar 90°"
      >
        <RotateCw className="h-4 w-4" />
      </button>
    </div>
  );
}
