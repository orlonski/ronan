"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { use, useMemo, useState } from "react";
import type { FonteGps } from "@ronan/shared-types";
import { ExcluirButton } from "@/components/excluir-button";
import { Permitido } from "@/components/requer-tela";
import { SinalGpsBadge } from "@/components/sinal-gps-badge";

// Leaflet quebra com SSR; carrega só no cliente.
const TrajetoMapPlayer = dynamic(
  () =>
    import("@/components/trajeto-map-player").then((m) => m.TrajetoMapPlayer),
  { ssr: false, loading: () => <div className="h-48 rounded-lg border bg-muted/30" /> },
);
const MapaTrajetoViagem = dynamic(
  () =>
    import("@/components/mapa-trajeto-viagem").then((m) => m.MapaTrajetoViagem),
  { ssr: false, loading: () => <div className="h-72 rounded-md border bg-muted/30" /> },
);
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Camera,
  CheckCircle2,
  Clock,
  CornerUpLeft,
  Crop,
  Edit3,
  Eye,
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
  Trash2,
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
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { fetchApi, useAuthToken } from "@/lib/client-api";
import {
  fmtBR,
  fmtBRL,
  fmtDataHoraBR,
  fmtNum,
} from "@/lib/fechamento-helpers";
import { ValorComMinimo } from "@/components/valor-com-minimo";
import { CropFotoModal } from "@/components/crop-foto-modal";
import { useHistoricoViagem } from "@/lib/fechamentos-api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DiagnosticoViagem } from "./_components/diagnostico-viagem";

type ViagemDetalhe = {
  id: string;
  data: string;
  toneladas: string;
  ticket: string | null;
  km: string;
  kmReal: string | null;
  kmCalculado: string | null;
  kmRecalculadoEm: string | null;
  kmAntesRecalculo: string | null;
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
  // Captura do GPS no clique "Estou no local de descarga"
  descargaLat: number | null;
  descargaLng: number | null;
  descargaPrecisao: number | null;
  descargaFonte: FonteGps | null;
  descargaRaioUsadoM: number | null;
  descargaDistanciaMetros: number | null;
  descargaBuscaOffline: boolean | null;
  // Captura do GPS ao escolher o local de carga no "Iniciar viagem" (raio da
  // carga virou ordenação, não trava — audita quão longe o motorista iniciou).
  cargaLat: number | null;
  cargaLng: number | null;
  cargaPrecisao: number | null;
  cargaFonte: FonteGps | null;
  cargaRaioUsadoM: number | null;
  cargaDistanciaMetros: number | null;
  cargaBuscaOffline: boolean | null;
  veiculo: { id: string; placa: string; modelo: string | null };
  motorista: { id: string; nome: string; cpf: string };
  cliente: { id: string; nome: string; empresa: { nome: string } };
  material: { id: string; nome: string; exigeTicket: boolean };
  localCarga: {
    id: string;
    nome: string;
    cidade: string;
    uf: string;
    logradouro: string;
    lat: number | null;
    lng: number | null;
  };
  localDescarga: {
    id: string;
    nome: string;
    cidade: string;
    uf: string;
    logradouro: string;
    lat: number | null;
    lng: number | null;
  };
  rotaGeometria: string | null;
  /** True quando o motorista escolheu a rota no seletor (≠ edição manual de km). */
  rotaEscolhida?: boolean;
  /** Variante de retorno em vigor: true=com retorno, false=direto, null=não definido. */
  retornoConfirmado?: boolean | null;
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
  // Limite de sinal fraco configurável — usado pra marcar a descarga em âmbar.
  const gpsConfig = useQuery({
    queryKey: ["busca-locais-config"],
    enabled: !!token,
    staleTime: 30 * 60_000,
    queryFn: () =>
      fetchApi<{ gpsLimiteSinalFracoM: number }>("/admin/busca-locais-config", { token }),
  });
  const limiteSinalFraco = gpsConfig.data?.gpsLimiteSinalFracoM ?? 50;
  const localCargaId = viagem.data?.localCarga.id;
  const localDescargaId = viagem.data?.localDescarga.id;
  const pedagiosNaRota = useQuery({
    queryKey: ["viagem-pedagios", localCargaId, localDescargaId],
    enabled: !!token && !!localCargaId && !!localDescargaId,
    staleTime: 60_000,
    queryFn: () =>
      fetchApi<
        Array<{
          id: string;
          nome: string;
          rodovia: string | null;
          concessionaria: string | null;
          distanciaMetros: number;
          lat: number;
          lng: number;
        }>
      >(
        `/admin/pedagios-rodovia/na-rota?origem=${localCargaId}&destino=${localDescargaId}`,
        { token },
      ),
  });
  const historico = useHistoricoViagem(id);
  const queryClient = useQueryClient();
  const recalcular = useMutation({
    mutationFn: () =>
      fetchApi<{ ok: true; km: string; kmCalculado: string }>(
        `/admin/viagens/${id}/recalcular-trajeto`,
        { method: "POST", token },
      ),
    onSuccess: (res) => {
      toast.success("Trajeto recalculado.", {
        description: `Km do motorista (${res.km}) preservado. Referência: ${res.kmCalculado}.`,
      });
      void queryClient.invalidateQueries({ queryKey: ["viagem-admin", id] });
      void queryClient.invalidateQueries({ queryKey: ["viagem-historico", id] });
    },
    onError: (err) => {
      toast.error("Não foi possível recalcular", {
        description: (err as Error).message,
      });
    },
  });
  // Seletor de rota alternativa (corrigir a estrada de uma viagem).
  const [escolhendoRota, setEscolhendoRota] = useState(false);
  const [rotaPreviewIdx, setRotaPreviewIdx] = useState<number | null>(null);
  const rotasAlt = useQuery({
    queryKey: ["viagem-rotas-alt", id],
    enabled: !!token && escolhendoRota,
    staleTime: 60_000,
    queryFn: () =>
      fetchApi<{
        rotas: {
          km: string;
          duracaoSegundos: number;
          geometria: string | null;
          recomendada: boolean;
        }[];
        erro?: string;
      }>(`/admin/viagens/${id}/rotas-alternativas`, { token }),
  });
  const escolherRota = useMutation({
    mutationFn: (rota: { km: string; geometria: string | null }) => {
      const rec = rotasAlt.data?.rotas.find((r) => r.recomendada);
      return fetchApi<unknown>(`/admin/viagens/${id}/escolher-rota`, {
        method: "POST",
        token,
        body: JSON.stringify({
          km: Number(rota.km),
          rotaGeometria: rota.geometria,
          kmCalculado: rec ? Number(rec.km) : undefined,
        }),
      });
    },
    onSuccess: () => {
      toast.success("Rota da viagem atualizada.");
      setEscolhendoRota(false);
      setRotaPreviewIdx(null);
      void queryClient.invalidateQueries({ queryKey: ["viagem-admin", id] });
      void queryClient.invalidateQueries({ queryKey: ["viagem-historico", id] });
    },
    onError: (err) => {
      toast.error("Não foi possível aplicar a rota", {
        description: (err as Error).message,
      });
    },
  });
  // Retorno na rodovia: variantes com/sem retorno (curb) do mesmo trajeto.
  // Buscado ao abrir a viagem; a seção só aparece quando há retorno real (2 opções).
  const [retornoPreviewIdx, setRetornoPreviewIdx] = useState<number | null>(null);
  const opcoesRetorno = useQuery({
    queryKey: ["viagem-opcoes-retorno", id],
    enabled: !!token && viagem.data?.status !== "EM_ANDAMENTO",
    staleTime: 5 * 60_000,
    queryFn: () =>
      fetchApi<{
        rotas: {
          km: string;
          duracaoSegundos: number;
          geometria: string | null;
          recomendada: boolean;
          retorno?: boolean;
        }[];
        erro?: string;
      }>(`/admin/viagens/${id}/rotas-opcoes`, { token }),
  });
  const aplicarRetorno = useMutation({
    mutationFn: (rota: { km: string; geometria: string | null; retorno?: boolean }) =>
      fetchApi<unknown>(`/admin/viagens/${id}/escolher-rota`, {
        method: "POST",
        token,
        body: JSON.stringify({
          km: Number(rota.km),
          rotaGeometria: rota.geometria,
          // kmCalculado = km da variante → km == kmCalculado, não vira divergência.
          kmCalculado: Number(rota.km),
          retornoConfirmado: rota.retorno,
        }),
      }),
    onSuccess: (_res, rota) => {
      toast.success(
        rota.retorno ? "Marcado: voltou no retorno." : "Marcado: seguiu direto.",
      );
      setRetornoPreviewIdx(null);
      void queryClient.invalidateQueries({ queryKey: ["viagem-admin", id] });
      void queryClient.invalidateQueries({ queryKey: ["viagem-historico", id] });
    },
    onError: (err) => {
      toast.error("Não foi possível aplicar", { description: (err as Error).message });
    },
  });
  const preValidar = useMutation({
    mutationFn: (body: {
      status: "OK" | "DIVERGENTE" | "DESFAZER";
      motivo?: string;
      tipo?: "PEDAGIO_SEM_VALOR" | "FOTO_ILEGIVEL" | "OUTRO";
    }) =>
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
  const [tipoDivergencia, setTipoDivergencia] = useState<
    "PEDAGIO_SEM_VALOR" | "FOTO_ILEGIVEL" | "OUTRO"
  >("OUTRO");
  const [motivoFoiEditado, setMotivoFoiEditado] = useState(false);

  // Props do mapa memoizadas (referência estável) pra o MapaTrajetoViagem (memo)
  // não re-renderizar à toa quando o resto da página muda. Antes dos guards por
  // regra de hooks — por isso referenciam viagem.data? (ainda pode estar nulo).
  const vd = viagem.data;
  const mapaCarga = useMemo(
    () =>
      vd?.localCarga.lat != null && vd?.localCarga.lng != null
        ? { lat: vd.localCarga.lat, lng: vd.localCarga.lng, nome: vd.localCarga.nome }
        : null,
    [vd?.localCarga.lat, vd?.localCarga.lng, vd?.localCarga.nome],
  );
  const mapaDescarga = useMemo(
    () =>
      vd?.localDescarga.lat != null && vd?.localDescarga.lng != null
        ? { lat: vd.localDescarga.lat, lng: vd.localDescarga.lng, nome: vd.localDescarga.nome }
        : null,
    [vd?.localDescarga.lat, vd?.localDescarga.lng, vd?.localDescarga.nome],
  );
  const mapaLancamento = useMemo(
    () => (vd?.lat != null && vd?.lng != null ? { lat: vd.lat, lng: vd.lng } : null),
    [vd?.lat, vd?.lng],
  );
  const mapaGeometria = useMemo(() => {
    // Preview do retorno tem prioridade, depois o seletor de estrada, senão a
    // geometria salva da viagem.
    if (retornoPreviewIdx != null) {
      return (
        opcoesRetorno.data?.rotas[retornoPreviewIdx]?.geometria ??
        vd?.rotaGeometria ??
        null
      );
    }
    if (escolhendoRota && rotaPreviewIdx != null) {
      return rotasAlt.data?.rotas[rotaPreviewIdx]?.geometria ?? vd?.rotaGeometria ?? null;
    }
    return vd?.rotaGeometria ?? null;
  }, [
    retornoPreviewIdx,
    opcoesRetorno.data,
    escolhendoRota,
    rotaPreviewIdx,
    rotasAlt.data,
    vd?.rotaGeometria,
  ]);
  const mapaPedagios = useMemo(() => pedagiosNaRota.data ?? [], [pedagiosNaRota.data]);

  if (viagem.isLoading) return <p className="text-sm text-muted-foreground">Carregando...</p>;
  if (!viagem.data) return <p className="text-sm text-red-600">Viagem não encontrada.</p>;
  const v = viagem.data;
  const emFechamento = v.matchesFechamento.length > 0;
  // Retorno na rodovia: só há escolha quando o backend devolve 2 variantes.
  // Ordem estável [sem_retorno, com_retorno]. Seleção = preview ou a em vigor.
  const retornoRotas = opcoesRetorno.data?.rotas ?? [];
  const temRetornoOpcoes = retornoRotas.length === 2;
  const retornoSelIdx =
    retornoPreviewIdx ?? retornoRotas.findIndex((r) => r.retorno === v.retornoConfirmado);
  const retornoEscolhida = retornoSelIdx >= 0 ? retornoRotas[retornoSelIdx] : undefined;
  const retornoJaEhAtual =
    retornoEscolhida != null && v.retornoConfirmado === retornoEscolhida.retorno;
  const pedagiosEncontrados = pedagiosNaRota.data ?? [];
  const semValorMasTemPedagio =
    !v.valorPedagioTotal && pedagiosEncontrados.length > 0;
  const motivoSugeridoPedagio = semValorMasTemPedagio
    ? `Valor de pedágio não preenchido. Rota passa por ${pedagiosEncontrados.length} pedágio(s) cadastrado(s): ${pedagiosEncontrados
        .slice(0, 5)
        .map((p) => p.nome)
        .join(", ")}${pedagiosEncontrados.length > 5 ? ", …" : ""}. Por favor, informe o valor.`
    : "";

  function motivoSugeridoPorTipo(
    tipo: "PEDAGIO_SEM_VALOR" | "FOTO_ILEGIVEL" | "OUTRO",
  ): string {
    if (tipo === "PEDAGIO_SEM_VALOR") return motivoSugeridoPedagio;
    if (tipo === "FOTO_ILEGIVEL")
      return "A foto enviada não permite identificar o ticket. Por favor, tire uma foto nova com boa iluminação e foco no número e na data.";
    return "";
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="flex min-w-0 flex-1 items-start gap-2 sm:gap-3">
          <Link href="/viagens" className="shrink-0">
            <span className="-ml-2 inline-flex rounded p-2 hover:bg-muted sm:ml-0">
              <ArrowLeft className="h-5 w-5" />
            </span>
          </Link>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
                {v.ticket ? `Viagem ${v.ticket}` : "Viagem sem ticket"}
              </h1>
              <Badge>{v.status}</Badge>
              {!v.material.exigeTicket && (
                <Badge className="border-amber-300 bg-amber-50 text-amber-700">
                  {v.material.nome} não exige ticket
                </Badge>
              )}
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {v.motorista.nome} · placa <span className="font-mono">{v.veiculo.placa}</span> ·{" "}
              {fmtBR(v.data)}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2 pl-8 sm:pl-0">
          {v.matchesFechamento.length === 0 ? (
            <Permitido chave="viagens.editar">
              <Link href={`/viagens/${v.id}/editar`}>
                <Button variant="outline" size="sm">
                  <Edit3 className="h-4 w-4" />
                  Editar
                </Button>
              </Link>
            </Permitido>
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
          <ExcluirButton perm="viagens.excluir"
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

      <div className="flex gap-1 overflow-x-auto border-b">
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
            className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-4 py-2 text-sm transition-colors ${
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
          <Card className="p-4 sm:p-5">
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
                      Number(v.kmCalculado) !== Number(v.km) &&
                      (v.rotaEscolhida ? (
                        // Motorista escolheu outra rota no seletor de mapa.
                        <span className="ml-2 inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                          Rota alternativa:{" "}
                          {Number(v.km) - Number(v.kmCalculado) > 0 ? "+" : ""}
                          {fmtNum(String(Number(v.km) - Number(v.kmCalculado)), 0)} km
                          {" "}vs. sugerida ({fmtNum(v.kmCalculado, 2)})
                        </span>
                      ) : (
                        // Ajuste manual do km (sem escolha de rota).
                        <span className="ml-1 text-xs text-muted-foreground">
                          (calculado: {fmtNum(v.kmCalculado, 2)})
                        </span>
                      ))}
                    {v.kmRecalculadoEm && (
                      <span
                        className="ml-2 inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700"
                        title="Viagem lançada sem sinal (km estimado) e recalculada pelo trajeto real quando sincronizou."
                      >
                        Km recalculado
                        {v.kmAntesRecalculo
                          ? `: de ${fmtNum(v.kmAntesRecalculo, 0)} → ${fmtNum(v.km, 0)} km`
                          : ""}
                      </span>
                    )}
                  </span>
                }
              />
              {v.kmReal && (
                <Row label="Km real (GPS)" value={fmtNum(v.kmReal, 2)} />
              )}
              {(v.cargaDistanciaMetros != null || v.cargaPrecisao != null) && (
                <Row
                  label="Marcação da carga"
                  value={<MarcacaoCarga viagem={v} limiteSinalFraco={limiteSinalFraco} />}
                />
              )}
              {(v.descargaDistanciaMetros != null || v.descargaPrecisao != null) && (
                <Row
                  label="Marcação da descarga"
                  value={<MarcacaoDescarga viagem={v} limiteSinalFraco={limiteSinalFraco} />}
                />
              )}
              <Row
                label="Ticket"
                value={
                  v.ticket ? (
                    v.ticket
                  ) : (
                    <span className="font-sans text-sm italic text-muted-foreground">
                      {v.material.exigeTicket ? "sem ticket" : "material não exige ticket"}
                    </span>
                  )
                }
                mono
                fromAi={v.ocrCampos?.includes("ticket")}
              />
              {v.valorPedagioTotal && <Row label="Pedágio" value={fmtBRL(v.valorPedagioTotal)} />}
              {v.observacao && <Row label="Observação" value={v.observacao} />}
            </dl>
          </Card>

          {/* Fotos do ticket: na coluna direita pra ficar lado a lado com
              os dados — admin confere foto + valores sem rolar. row-span-3
              estende embaixo de Trajeto + Pré-validação também (mantém
              foto longa sem deixar espaço vazio na esquerda). */}
          <Card className="p-4 sm:p-5 md:row-span-3">
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

          <Card className="p-4 sm:p-5">
            <h3 className="mb-3 text-base font-medium">Trajeto</h3>
            <div className="space-y-3 text-sm">
              <div>
                <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <ArrowUp className="h-3.5 w-3.5" /> Carga
                </div>
                <Link
                  href={`/locais/${v.localCarga.id}/ver`}
                  title="Ver local"
                  className="mt-0.5 inline-flex items-center gap-1 font-medium hover:text-primary hover:underline"
                >
                  {v.localCarga.nome}
                  <Eye className="h-3.5 w-3.5 shrink-0 opacity-70" />
                </Link>
                <p className="text-xs text-muted-foreground">
                  {v.localCarga.logradouro} — {v.localCarga.cidade}/{v.localCarga.uf}
                </p>
              </div>
              <div>
                <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <ArrowDown className="h-3.5 w-3.5" /> Descarga
                </div>
                <Link
                  href={`/locais/${v.localDescarga.id}/ver`}
                  title="Ver local"
                  className="mt-0.5 inline-flex items-center gap-1 font-medium hover:text-primary hover:underline"
                >
                  {v.localDescarga.nome}
                  <Eye className="h-3.5 w-3.5 shrink-0 opacity-70" />
                </Link>
                <p className="text-xs text-muted-foreground">
                  {v.localDescarga.logradouro} — {v.localDescarga.cidade}/{v.localDescarga.uf}
                </p>
              </div>
            </div>
          </Card>

          {/* Pré-validação: coluna 1 também, logo após Trajeto, pra preencher
              o espaço embaixo (Fotos do ticket ocupa col 2 com row-span-3). */}
          <Card className="p-4 sm:p-5">
            <h3 className="mb-3 flex items-center gap-2 text-base font-medium">
              <ShieldCheck className="h-4 w-4" /> Pré-validação
            </h3>
            {v.status === "AJUSTADA" ? (
              <div className="space-y-3">
                <p className="text-sm">
                  <Badge className="border-blue-200 bg-blue-100 text-blue-900">
                    Aguardando sua revisão
                  </Badge>
                  <span className="ml-2 text-muted-foreground">
                    motorista respondeu à divergência
                  </span>
                </p>
                {v.motivoStatus && (
                  <p className="rounded-md border bg-muted/30 p-3 text-sm">
                    <span className="font-medium">Você pediu:</span>{" "}
                    {v.motivoStatus}
                  </p>
                )}
                <p className="text-sm text-muted-foreground">
                  Revise a correção e aprove ou recuse de novo.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="success"
                    onClick={() => preValidar.mutate({ status: "OK" })}
                    disabled={preValidar.isPending || emFechamento}
                  >
                    <ThumbsUp className="h-4 w-4" /> Aprovar correção
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => {
                      setTipoDivergencia("OUTRO");
                      setMotivoTexto("");
                      setMotivoFoiEditado(false);
                      setDialogDivergente(true);
                    }}
                    disabled={preValidar.isPending || emFechamento}
                  >
                    <ThumbsDown className="h-4 w-4" /> Recusar de novo
                  </Button>
                </div>
              </div>
            ) : v.revisadoEm ? (
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
                {semValorMasTemPedagio && (
                  <div className="flex items-start gap-2 rounded-md border border-orange-200 bg-orange-50 p-3 text-sm text-orange-900">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <div className="space-y-1">
                      <p className="font-medium">
                        Sem valor de pedágio, mas rota passa por{" "}
                        {pedagiosEncontrados.length} pedágio
                        {pedagiosEncontrados.length === 1 ? "" : "s"}.
                      </p>
                      <p className="text-xs">
                        {pedagiosEncontrados
                          .slice(0, 5)
                          .map((p) => p.nome + (p.rodovia ? ` (${p.rodovia})` : ""))
                          .join(" · ")}
                        {pedagiosEncontrados.length > 5
                          ? ` · +${pedagiosEncontrados.length - 5}`
                          : ""}
                      </p>
                    </div>
                  </div>
                )}
                <p className="text-sm text-muted-foreground">
                  Marque como validada ou divergente antes do fechamento.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="success"
                    onClick={() => preValidar.mutate({ status: "OK" })}
                    disabled={preValidar.isPending || emFechamento}
                    title={
                      emFechamento
                        ? "Viagem em fechamento — desfaça o match antes de pré-validar"
                        : undefined
                    }
                  >
                    <ThumbsUp className="h-4 w-4" /> Marcar como validada
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => {
                      const tipoInicial = semValorMasTemPedagio
                        ? "PEDAGIO_SEM_VALOR"
                        : "OUTRO";
                      setTipoDivergencia(tipoInicial);
                      setMotivoTexto(motivoSugeridoPorTipo(tipoInicial));
                      setMotivoFoiEditado(false);
                      setDialogDivergente(true);
                    }}
                    disabled={preValidar.isPending || emFechamento}
                    title={
                      emFechamento
                        ? "Viagem em fechamento — desfaça o match antes de pré-validar"
                        : undefined
                    }
                  >
                    <ThumbsDown className="h-4 w-4" /> Marcar como divergente
                  </Button>
                </div>
              </div>
            )}
          </Card>

          {v.pontos && v.pontos.length >= 2 && (
            <Card className="p-4 sm:p-5 md:col-span-2">
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
            <Card className="p-4 sm:p-5 md:col-span-2">
              <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                <h3 className="flex items-center gap-2 text-base font-medium">
                  <MapPin className="h-4 w-4" /> Trajeto da viagem
                </h3>
                <Permitido chave="viagens.editar">
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => recalcular.mutate()}
                      disabled={recalcular.isPending}
                      title="Atualiza a polilinha e a referência de cálculo (OSRM). NÃO altera o km do motorista — esse prevalece sempre."
                    >
                      <RefreshCw
                        className={`h-4 w-4 ${recalcular.isPending ? "animate-spin" : ""}`}
                      />
                      {recalcular.isPending ? "Recalculando…" : "Recalcular trajeto"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setEscolhendoRota((s) => !s);
                        setRotaPreviewIdx(null);
                      }}
                      title="Escolher entre as rotas alternativas do OSRM"
                    >
                      <MapPin className="h-4 w-4" />
                      {escolhendoRota ? "Fechar" : "Escolher rota"}
                    </Button>
                  </div>
                </Permitido>
              </div>
              {escolhendoRota && (
                <div className="mb-3 rounded-lg border bg-muted/20 p-3">
                  {rotasAlt.isLoading ? (
                    <p className="text-sm text-muted-foreground">Buscando rotas…</p>
                  ) : rotasAlt.data && rotasAlt.data.rotas.length === 1 ? (
                    <div className="space-y-2">
                      <p className="text-sm text-muted-foreground">
                        Esse trajeto só tem um caminho no mapa (
                        {fmtNum(rotasAlt.data.rotas[0]!.km, 2)} km ·{" "}
                        {Math.round(rotasAlt.data.rotas[0]!.duracaoSegundos / 60)} min) — o
                        OSRM não encontrou rota alternativa pra escolher. Pra ajustar o km,
                        use a edição da viagem.
                      </p>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEscolhendoRota(false);
                          setRotaPreviewIdx(null);
                        }}
                      >
                        Fechar
                      </Button>
                    </div>
                  ) : rotasAlt.data && rotasAlt.data.rotas.length > 1 ? (
                    <div className="space-y-2">
                      <p className="text-sm font-medium">
                        Escolha a estrada usada (clique pra ver no mapa):
                      </p>
                      {rotasAlt.data.rotas.map((r, idx) => {
                        const rec = rotasAlt.data!.rotas.find((x) => x.recomendada);
                        const diff = rec ? Number(r.km) - Number(rec.km) : 0;
                        const sel = rotaPreviewIdx === idx;
                        return (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => setRotaPreviewIdx(idx)}
                            className={`flex w-full items-center justify-between gap-3 rounded-md border p-2.5 text-left text-sm ${
                              sel ? "border-primary bg-primary/5" : "hover:bg-muted"
                            }`}
                          >
                            <span>
                              <span className="font-semibold">{fmtNum(r.km, 2)} km</span>
                              <span className="text-muted-foreground">
                                {" · "}
                                {Math.round(r.duracaoSegundos / 60)} min
                              </span>
                              {r.recomendada ? (
                                <Badge className="ml-2 bg-muted text-muted-foreground">
                                  Sugerida
                                </Badge>
                              ) : diff !== 0 ? (
                                <span className="ml-2 text-xs text-amber-700">
                                  {diff > 0 ? "+" : ""}
                                  {fmtNum(String(diff), 0)} km vs. sugerida
                                </span>
                              ) : null}
                            </span>
                            {sel && <CheckCircle2 className="h-4 w-4 text-primary" />}
                          </button>
                        );
                      })}
                      <div className="flex gap-2 pt-1">
                        <Button
                          size="sm"
                          disabled={rotaPreviewIdx == null || escolherRota.isPending}
                          onClick={() => {
                            const r = rotasAlt.data!.rotas[rotaPreviewIdx!];
                            if (r) escolherRota.mutate({ km: r.km, geometria: r.geometria });
                          }}
                        >
                          {escolherRota.isPending ? "Aplicando…" : "Aplicar esta rota"}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setEscolhendoRota(false);
                            setRotaPreviewIdx(null);
                          }}
                        >
                          Cancelar
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {rotasAlt.data?.erro ?? "Sem rotas alternativas pra esse trajeto."}
                    </p>
                  )}
                </div>
              )}
              {temRetornoOpcoes && (
                <div className="mb-3 rounded-lg border bg-muted/20 p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <CornerUpLeft className="h-4 w-4 text-muted-foreground" />
                    <p className="text-sm font-medium">Retorno na rodovia</p>
                    <span className="text-xs text-muted-foreground">
                      esse ponto tem retorno — confirme o que o motorista fez
                    </span>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {retornoRotas.map((r, idx) => {
                      const atual = v.retornoConfirmado === r.retorno;
                      const sel = retornoSelIdx === idx;
                      return (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => setRetornoPreviewIdx(idx)}
                          className={`flex flex-col gap-1 rounded-md border p-3 text-left transition-colors ${
                            sel ? "border-primary bg-primary/5" : "hover:bg-muted"
                          }`}
                        >
                          <span className="flex items-center justify-between gap-2">
                            <span className="text-sm font-medium">
                              {r.retorno ? "Precisou voltar no retorno" : "Cheguei direto"}
                            </span>
                            {sel && <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />}
                          </span>
                          <span className="text-lg font-semibold">{fmtNum(r.km, 1)} km</span>
                          {atual && (
                            <Badge className="w-fit bg-emerald-100 text-emerald-700">
                              Em vigor
                            </Badge>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  <Permitido chave="viagens.editar">
                    <div className="flex items-center gap-2 pt-2">
                      <Button
                        size="sm"
                        disabled={
                          !retornoEscolhida || retornoJaEhAtual || aplicarRetorno.isPending
                        }
                        onClick={() =>
                          retornoEscolhida &&
                          aplicarRetorno.mutate({
                            km: retornoEscolhida.km,
                            geometria: retornoEscolhida.geometria,
                            retorno: retornoEscolhida.retorno,
                          })
                        }
                      >
                        {aplicarRetorno.isPending ? "Aplicando…" : "Aplicar"}
                      </Button>
                      {retornoPreviewIdx != null && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setRetornoPreviewIdx(null)}
                        >
                          Cancelar
                        </Button>
                      )}
                      <span className="text-xs text-muted-foreground">
                        Atualiza o km faturado e a rota do mapa. O recalcular respeita a escolha.
                      </span>
                    </div>
                  </Permitido>
                </div>
              )}
              <MapaTrajetoViagem
                carga={mapaCarga}
                descarga={mapaDescarga}
                lancamento={mapaLancamento}
                geometria={mapaGeometria}
                pedagios={mapaPedagios}
              />
            </Card>
          )}

          {v.matchesFechamento.length > 0 && (
            <Card className="p-4 sm:p-5 md:col-span-2">
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
        <Card className="p-4 sm:p-5">
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
              Escolha o tipo do problema. Quando o tipo abre fluxo dedicado no
              app, o motorista vê um botão direto pra resolver (informar valor
              de pedágio, tirar foto nova, etc).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="tipo-divergencia">Tipo</Label>
              <Select
                id="tipo-divergencia"
                value={tipoDivergencia}
                onChange={(e) => {
                  const novo = e.target.value as typeof tipoDivergencia;
                  setTipoDivergencia(novo);
                  if (!motivoFoiEditado) {
                    setMotivoTexto(motivoSugeridoPorTipo(novo));
                  }
                }}
              >
                <option value="PEDAGIO_SEM_VALOR">
                  Falta valor de pedágio
                </option>
                <option value="FOTO_ILEGIVEL">
                  Foto ilegível / não aparece o ticket
                </option>
                <option value="OUTRO">Outro motivo</option>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Motivo (mínimo 2 caracteres)</Label>
              <Textarea
                rows={4}
                value={motivoTexto}
                onChange={(e) => {
                  setMotivoTexto(e.target.value);
                  setMotivoFoiEditado(true);
                }}
                placeholder="Ex: Toneladas não conferem com ticket fotografado"
                maxLength={500}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogDivergente(false)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                preValidar.mutate(
                  {
                    status: "DIVERGENTE",
                    motivo: motivoTexto.trim(),
                    tipo: tipoDivergencia,
                  },
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
    <div className="flex flex-col gap-0.5 sm:flex-row sm:justify-between sm:gap-3">
      <dt className="shrink-0 text-muted-foreground">
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
      <dd className={`min-w-0 break-words sm:text-right ${mono ? "font-mono" : ""}`}>
        {value}
      </dd>
    </div>
  );
}

// Mostra quão confiável foi a marcação da descarga pelo motorista: distância
// do GPS no clique até o local escolhido + precisão do sinal. Destaca em âmbar
// quando ficou ruim (longe do local ou sinal fraco) — sinal de revisar.
function MarcacaoDescarga({
  viagem,
  limiteSinalFraco,
}: {
  viagem: ViagemDetalhe;
  limiteSinalFraco: number;
}) {
  const dist = viagem.descargaDistanciaMetros;
  const prec = viagem.descargaPrecisao;
  const partes: string[] = [];
  if (dist != null) partes.push(dist === 0 ? "local criado aqui" : `${dist} m do local`);
  if (prec != null) partes.push(`precisão ±${Math.round(prec)} m`);
  // Raio em que o local foi encontrado na busca (config do painel). Auditoria
  // de quão "solta" foi a marcação — quanto maior o raio, mais permissiva.
  if (viagem.descargaRaioUsadoM != null) partes.push(`raio usado ${viagem.descargaRaioUsadoM} m`);
  // Busca offline: o app procurou o local no catálogo em cache (sem internet),
  // então pode ter faltado algum local recém-criado por outro motorista.
  if (viagem.descargaBuscaOffline) partes.push("busca offline");
  const suspeito = (dist != null && dist > 200) || (prec != null && prec > limiteSinalFraco);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span
        className={suspeito ? "text-amber-600" : ""}
        style={{ fontVariant: "tabular-nums" }}
        title={
          viagem.descargaLat != null && viagem.descargaLng != null
            ? `GPS do clique: ${viagem.descargaLat}, ${viagem.descargaLng}`
            : undefined
        }
      >
        {partes.join(" · ")}
        {suspeito && " ⚠️"}
      </span>
      <SinalGpsBadge
        precisao={prec}
        fonte={viagem.descargaFonte}
        limiteSinalFraco={limiteSinalFraco}
      />
    </span>
  );
}

// Gêmeo do MarcacaoDescarga pro LOCAL DE CARGA no "Iniciar viagem": distância
// do GPS do motorista até o local escolhido + precisão. Como o raio da carga
// virou ordenação (não trava), destaca em âmbar quando ele iniciou FORA do raio
// usado (ou com sinal fraco) — sinal de que carregou longe do local.
function MarcacaoCarga({
  viagem,
  limiteSinalFraco,
}: {
  viagem: ViagemDetalhe;
  limiteSinalFraco: number;
}) {
  const dist = viagem.cargaDistanciaMetros;
  const prec = viagem.cargaPrecisao;
  const raio = viagem.cargaRaioUsadoM;
  const partes: string[] = [];
  if (dist != null) partes.push(`${dist} m do local`);
  if (prec != null) partes.push(`precisão ±${Math.round(prec)} m`);
  if (raio != null) partes.push(`raio usado ${raio} m`);
  if (viagem.cargaBuscaOffline) partes.push("busca offline");
  // Fora do raio = distância maior que o raio em que buscou (fallback 200 m se
  // não gravou o raio). Também marca sinal fraco.
  const foraDoRaio = dist != null && dist > (raio ?? 200);
  const suspeito = foraDoRaio || (prec != null && prec > limiteSinalFraco);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span
        className={suspeito ? "text-amber-600" : ""}
        style={{ fontVariant: "tabular-nums" }}
        title={
          viagem.cargaLat != null && viagem.cargaLng != null
            ? `GPS do motorista ao escolher a carga: ${viagem.cargaLat}, ${viagem.cargaLng}`
            : undefined
        }
      >
        {partes.join(" · ")}
        {foraDoRaio && " · fora do raio"}
        {suspeito && " ⚠️"}
      </span>
      <SinalGpsBadge
        precisao={prec}
        fonte={viagem.cargaFonte}
        limiteSinalFraco={limiteSinalFraco}
      />
    </span>
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
  kmCalculado: "Km calculado",
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
    mutationFn: (file: File | Blob) => {
      const fd = new FormData();
      const name = file instanceof File ? file.name : "recorte.jpg";
      fd.append("foto", file, name);
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

  const excluirFoto = useMutation({
    mutationFn: (fotoId: string) =>
      fetchApi(`/admin/viagens/${viagemId}/fotos/${fotoId}`, {
        method: "DELETE",
        token,
      }),
    onSuccess: () => {
      toast.success("Foto removida.");
      void qc.invalidateQueries({ queryKey: ["viagem-admin", viagemId] });
    },
    onError: (err) => toast.error("Falha ao remover", { description: (err as Error).message }),
  });

  // Foto sendo recortada — null = modal fechado.
  const [recortarFoto, setRecortarFoto] = useState<{ url: string } | null>(null);

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
            onRecortar={(url) => setRecortarFoto({ url })}
            onRemover={() => {
              if (confirm("Remover esta foto? Não pode ser desfeito.")) {
                excluirFoto.mutate(f.id);
              }
            }}
          />
        ))}
      </div>

      <CropFotoModal
        open={!!recortarFoto}
        src={recortarFoto?.url ?? ""}
        onCancel={() => setRecortarFoto(null)}
        onConfirmar={async (blob) => {
          await adicionar.mutateAsync(blob);
          setRecortarFoto(null);
        }}
      />

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
  onRecortar,
  onRemover,
}: {
  viagemId: string;
  fotoId: string;
  rotacao: number;
  token: string | undefined;
  onClick: (url: string) => void;
  onRotacionar: () => void;
  onRecortar: (url: string) => void;
  onRemover: () => void;
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
      <div className="flex h-48 flex-col items-center justify-center gap-1 rounded-md border border-dashed bg-muted/30 text-xs text-muted-foreground">
        <ImageOff className="h-7 w-7 opacity-40" />
        <span>Foto indisponível</span>
      </div>
    );
  }

  if (q.isLoading || !q.data) {
    return (
      <div className="flex h-48 items-center justify-center rounded-md border bg-muted text-xs text-muted-foreground">
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
      onRecortar={() => onRecortar(q.data!)}
      onRemover={onRemover}
    />
  );
}

function FotoThumbInner({
  src,
  rotacao,
  onClick,
  onRotacionar,
  onRecortar,
  onRemover,
}: {
  src: string;
  rotacao: number;
  onClick: () => void;
  onRotacionar: () => void;
  onRecortar: () => void;
  onRemover: () => void;
}) {
  return (
    <div className="relative w-full overflow-hidden rounded-md border bg-muted">
      <button
        type="button"
        onClick={onClick}
        className="block w-full cursor-zoom-in"
        title="Clique pra ampliar"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt="Ticket"
          className="block max-h-[70vh] w-full object-contain"
          style={{ transform: `rotate(${rotacao}deg)` }}
        />
      </button>
      <div className="absolute right-1 top-1 z-10 flex gap-1">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRotacionar();
          }}
          className="rounded-md bg-black/60 p-1.5 text-white shadow hover:bg-black/80"
          title="Rotacionar 90°"
        >
          <RotateCw className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRecortar();
          }}
          className="rounded-md bg-black/60 p-1.5 text-white shadow hover:bg-black/80"
          title="Recortar"
        >
          <Crop className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemover();
          }}
          className="rounded-md bg-red-600/80 p-1.5 text-white shadow hover:bg-red-700"
          title="Remover foto"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
