import { lazy, Suspense, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Building2,
  Sparkles,
  Trash2,
} from "lucide-react";
import { ScreenHeader } from "@/components/screen-header";
import { AuthedImage } from "@/components/authed-image";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PhotoCapture } from "@/components/photo-capture";
import { usePendingFotosViagem } from "@/hooks/use-pending-fotos-viagem";
import { showAlert, showConfirm } from "@/lib/alert";
import { humanizeApiError } from "@/lib/api";
import { fmtDataBR } from "@/lib/datetime";
import type { FotoComprimida } from "@/lib/photo";
import { enqueueFoto } from "@/lib/sync";
import { fmtNum } from "@/lib/utils";
import {
  useExcluirViagem,
  useInformarValorPedagio,
  usePedagiosNaRota,
  useViagemDetalhe,
} from "@/lib/queries";

const MapTrajeto = lazy(() =>
  import("@/components/map-trajeto").then((m) => ({ default: m.MapTrajeto })),
);

const STATUS_VARIANT: Record<
  string,
  "default" | "secondary" | "outline" | "destructive" | "success" | "warning"
> = {
  ENVIADA: "warning",
  OK: "success",
  EM_CONFERENCIA: "warning",
  DIVERGENTE: "destructive",
  AJUSTADA: "secondary",
};

const STATUS_LABEL: Record<string, string> = {
  ENVIADA: "Enviada",
  OK: "Conferida",
  EM_CONFERENCIA: "Conferindo",
  DIVERGENTE: "Divergente",
  AJUSTADA: "Ajustada",
};

export default function ViagemDetalhePage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const detalhe = useViagemDetalhe(id ?? "");
  const pedagiosNaRota = usePedagiosNaRota(
    detalhe.data?.localCarga.id,
    detalhe.data?.localDescarga.id,
  );
  const excluir = useExcluirViagem();
  const informarPedagio = useInformarValorPedagio();
  const [valorPedagioStr, setValorPedagioStr] = useState("");
  const pendingFotos = usePendingFotosViagem(detalhe.data?.id);

  async function onFotoCapturada(foto: FotoComprimida | null) {
    if (!foto || !detalhe.data) return;
    try {
      await enqueueFoto({
        viagemId: detalhe.data.id,
        blob: foto.blob,
        mime: foto.mime,
      });
      // Feedback visual vem via pendingFotos — foto aparece com badge "enviando".
    } catch (err) {
      void showAlert({
        title: "Erro ao anexar foto",
        message: humanizeApiError(err),
        variant: "destructive",
      });
    }
  }

  async function confirmarExcluir() {
    if (!detalhe.data) return;
    const ok = await showConfirm({
      title: "Excluir esta viagem?",
      message: `Apagar viagem ticket ${detalhe.data.ticket}? Isso só pode ser feito enquanto a operadora não conferiu.`,
      confirmLabel: "Excluir",
      destructive: true,
    });
    if (!ok) return;
    try {
      await excluir.mutateAsync(detalhe.data.id);
      navigate(-1);
    } catch (err) {
      void showAlert({
        title: "Não foi possível excluir",
        message: humanizeApiError(err),
        variant: "destructive",
      });
    }
  }

  const d = detalhe.data;

  const temPontos = d && d.pontos && d.pontos.length > 1;
  const temGeometria = !!d?.rotaGeometria;
  const temCargaCoords = d && d.localCarga.lat != null && d.localCarga.lng != null;
  const temDescargaCoords = d && d.localDescarga.lat != null && d.localDescarga.lng != null;
  const mostrarMapa = temPontos || temGeometria || (temCargaCoords && temDescargaCoords);

  return (
    <div className="flex min-h-screen-safe flex-col bg-background pb-20">
      <ScreenHeader title="Detalhe da viagem" />

      {detalhe.isLoading && (
        <div className="py-12 text-center text-sm text-muted-foreground">Carregando...</div>
      )}

      {detalhe.error && (
        <div className="m-4 rounded-lg border border-destructive bg-destructive/10 p-4">
          <p className="font-semibold text-destructive">{humanizeApiError(detalhe.error)}</p>
        </div>
      )}

      {d && (
        <div className="space-y-4 p-4 pb-32">
          <Card>
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Cliente
                </p>
                <p className="mt-0.5 text-xl font-bold text-foreground">{d.cliente.nome}</p>
                {d.cliente.empresa && (
                  <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Building2 size={14} /> {d.cliente.empresa.nome}
                  </p>
                )}
              </div>
              <Badge variant={STATUS_VARIANT[d.status] ?? "outline"}>
                {STATUS_LABEL[d.status] ?? d.status}
              </Badge>
            </div>

            <div className="mt-4 flex gap-6 border-t-2 border-border pt-3">
              <Info label="Data" value={fmtDataBR(d.data)} />
              <Info label="Placa" value={d.veiculo.placa} mono />
              <Info label="Material" value={d.material.nome} />
            </div>
          </Card>

          {d.status === "DIVERGENTE" &&
            d.tipoDivergencia === "PEDAGIO_SEM_VALOR" && (
              <Card className="border-2 border-orange-500 bg-orange-50 p-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle size={20} className="mt-0.5 text-orange-600" />
                  <div className="flex-1">
                    <p className="text-base font-bold text-orange-900">
                      Falta informar o valor do pedágio
                    </p>
                    {d.motivoStatus && (
                      <p className="mt-1 text-sm text-foreground">{d.motivoStatus}</p>
                    )}
                    <div className="mt-3 flex items-center gap-2">
                      <span className="text-sm text-foreground">R$</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={valorPedagioStr}
                        onChange={(e) => setValorPedagioStr(e.target.value)}
                        placeholder="0,00"
                        className="h-11 flex-1 rounded-md border border-input bg-white px-3 text-base text-foreground"
                      />
                    </div>
                    <Button
                      className="mt-3"
                      loading={informarPedagio.isPending}
                      disabled={!valorPedagioStr.trim()}
                      onClick={async () => {
                        const v = parseFloat(valorPedagioStr.replace(",", "."));
                        if (isNaN(v) || v <= 0) {
                          void showAlert({
                            title: "Valor inválido",
                            message: "Informe um valor maior que zero.",
                          });
                          return;
                        }
                        try {
                          await informarPedagio.mutateAsync({
                            viagemId: d.id,
                            valor: v,
                          });
                          setValorPedagioStr("");
                          void showAlert({
                            title: "Obrigado!",
                            message:
                              "Valor informado — viagem foi marcada como ajustada.",
                          });
                        } catch (err) {
                          void showAlert({
                            title: "Erro",
                            message: humanizeApiError(err),
                          });
                        }
                      }}
                    >
                      Informar valor
                    </Button>
                  </div>
                </div>
              </Card>
            )}

          {d.status === "DIVERGENTE" &&
            d.tipoDivergencia !== "PEDAGIO_SEM_VALOR" &&
            d.motivoStatus && (
              <Card className="border-2 border-destructive bg-destructive/10 p-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle size={20} className="mt-0.5 text-destructive" />
                  <div className="flex-1">
                    <p className="text-base font-bold text-destructive">
                      Viagem marcada como divergente
                    </p>
                    <p className="mt-1 text-sm text-foreground">{d.motivoStatus}</p>
                  </div>
                </div>
              </Card>
            )}

          <Card>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Trajeto
            </p>
            <div className="space-y-2">
              <div className="flex items-start gap-3">
                <ArrowUp size={20} className="text-success mt-0.5" />
                <div className="flex-1">
                  <p className="text-base font-semibold text-foreground">{d.localCarga.nome}</p>
                  <p className="text-sm text-muted-foreground">
                    {d.localCarga.logradouro} — {d.localCarga.cidade}/{d.localCarga.uf}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <ArrowDown size={20} className="text-destructive mt-0.5" />
                <div className="flex-1">
                  <p className="text-base font-semibold text-foreground">{d.localDescarga.nome}</p>
                  <p className="text-sm text-muted-foreground">
                    {d.localDescarga.logradouro} — {d.localDescarga.cidade}/{d.localDescarga.uf}
                  </p>
                </div>
              </div>
            </div>
          </Card>

          {mostrarMapa && (
            <Suspense
              fallback={
                <div className="skeleton-pulse h-72 rounded-2xl bg-muted" aria-hidden />
              }
            >
              <MapTrajeto
                pontosCrus={temPontos ? d.pontos.map((p) => ({ lat: p.lat, lng: p.lng })) : undefined}
                geometria={d.rotaGeometria ?? null}
                carga={
                  temCargaCoords
                    ? { lat: d.localCarga.lat as number, lng: d.localCarga.lng as number, nome: d.localCarga.nome }
                    : null
                }
                descarga={
                  temDescargaCoords
                    ? {
                        lat: d.localDescarga.lat as number,
                        lng: d.localDescarga.lng as number,
                        nome: d.localDescarga.nome,
                      }
                    : null
                }
                pedagios={pedagiosNaRota.data ?? []}
              />
            </Suspense>
          )}

          <Card>
            <div className="flex gap-6">
              <Stat
                label="Toneladas"
                value={fmtNum(d.toneladasEfetiva, 3)}
                fromAi={d.ocrCampos?.includes("toneladas")}
                subValue={
                  d.toneladasAjustada
                    ? `informado ${fmtNum(d.toneladasInformada, 3)}`
                    : undefined
                }
              />
              <Stat
                label="Km"
                value={fmtNum(d.kmEfetivo, 2)}
                fromAi={d.ocrCampos?.includes("km")}
                subValue={d.kmAjustada ? `informado ${fmtNum(d.kmInformado, 2)}` : undefined}
              />
              <Stat
                label="Ticket"
                value={d.ticket}
                fromAi={d.ocrCampos?.includes("ticket")}
              />
            </div>
            {d.ocrConfidence != null && (d.ocrCampos?.length ?? 0) > 0 && (
              <p className="mt-3 flex items-center gap-1.5 border-t-2 border-border pt-3 text-xs text-muted-foreground">
                <Sparkles size={12} className="text-primary" />
                Alguns campos foram preenchidos pela IA (confiança{" "}
                {Math.round(d.ocrConfidence * 100)}%)
              </p>
            )}
          </Card>

          {d.observacao && (
            <Card>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Observação
              </p>
              <p className="text-base text-foreground whitespace-pre-line">{d.observacao}</p>
            </Card>
          )}

          <Card className="p-3">
            <p className="mb-2 px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Foto do ticket
            </p>
            {(!d.fotos || d.fotos.length === 0) && pendingFotos.length === 0 && (
              <p className="px-2 text-sm text-muted-foreground">
                Nenhuma foto anexada.
              </p>
            )}
            {((d.fotos && d.fotos.length > 0) || pendingFotos.length > 0) && (
              <div className="space-y-2">
                {d.fotos?.map((f) => (
                  <AuthedImage
                    key={f.id}
                    path={`/m/viagens/${d.id}/fotos/${f.id}`}
                    alt={`Ticket ${d.ticket}`}
                    className="max-h-[60vh]"
                  />
                ))}
                {pendingFotos.map((f) => (
                  <PendingFotoPreview key={f.clientId} foto={f} />
                ))}
              </div>
            )}
            <div className="mt-3 space-y-2">
              {/* value sempre null → reseta. onChange enfileira direto. */}
              <PhotoCapture value={null} onChange={onFotoCapturada} />
            </div>
          </Card>

          {d.status === "ENVIADA" && (
            <Button
              onClick={confirmarExcluir}
              variant="destructive"
              size="lg"
              className="w-full"
              loading={excluir.isPending}
            >
              <Trash2 size={18} />
              Excluir viagem
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function PendingFotoPreview({
  foto,
}: {
  foto: { clientId: string; fotoBlob: Blob; status: string };
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const u = URL.createObjectURL(foto.fotoBlob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [foto.fotoBlob]);
  if (!url) return null;
  const label = foto.status === "error" ? "Erro — vai tentar de novo" : "Enviando…";
  return (
    <div className="relative">
      <img
        src={url}
        alt="Foto pendente"
        className="max-h-[60vh] w-full rounded-md object-contain opacity-75"
      />
      <span className="absolute right-2 top-2 rounded-full bg-amber-500 px-3 py-1 text-xs font-bold text-white">
        {label}
      </span>
    </div>
  );
}

function Info({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`text-base font-semibold text-foreground ${mono ? "tabular" : ""}`}>{value}</p>
    </div>
  );
}

function Stat({
  label,
  value,
  subValue,
  fromAi,
}: {
  label: string;
  value: string;
  subValue?: string;
  fromAi?: boolean;
}) {
  return (
    <div>
      <div className="flex items-center gap-1">
        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
        {fromAi && <Sparkles size={10} className="text-primary" />}
      </div>
      <p className="text-lg font-bold text-foreground tabular">{value}</p>
      {subValue && <p className="text-[10px] text-muted-foreground">{subValue}</p>}
    </div>
  );
}
