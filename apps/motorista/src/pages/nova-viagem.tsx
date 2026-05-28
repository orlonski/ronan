import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Check, Sparkles, X } from "lucide-react";
import { CriarViagemInput } from "@ronan/shared-types";
import type { ExtrairTicketResult } from "@ronan/shared-types";
import { ScreenHeader } from "@/components/screen-header";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, type SelectOption } from "@/components/ui/select";
import { PhotoCapture } from "@/components/photo-capture";
import { DescargaPorGps } from "@/components/descarga-por-gps";
import { showAlert } from "@/lib/alert";
import { humanizeApiError } from "@/lib/api";
import { fmtDataBR } from "@/lib/datetime";
import { humanizeZodError } from "@/lib/validation";
import { listPendingViagens, type PendingViagem } from "@/db/dexie";
import {
  useCalcularRota,
  useCatalogos,
  useCriarViagem,
  useExtrairTicket,
  useMe,
  type Catalogos,
  type Local,
} from "@/lib/queries";
import { atualizarViagemPendente } from "@/lib/sync";
import { gerarClientId } from "@/lib/utils";
import { hojeISO } from "@/lib/datetime";
import type { FotoComprimida } from "@/lib/photo";

type FormShape = {
  veiculoId: string;
  clienteId: string;
  materialId: string;
  data: string;
  toneladas: string;
  ticket: string;
  km: string;
  localCargaId: string;
  localDescargaId: string;
  valorPedagio: string;
  observacao: string;
};

function numToStr(n: unknown): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "";
  return String(n).replace(".", ",");
}

const empty: FormShape = {
  veiculoId: "",
  clienteId: "",
  materialId: "",
  data: hojeISO(),
  toneladas: "",
  ticket: "",
  km: "",
  localCargaId: "",
  localDescargaId: "",
  valorPedagio: "",
  observacao: "",
};

export default function NovaViagemPage() {
  const navigate = useNavigate();
  const params = useParams<{ clientId?: string }>();
  const modoEdit = !!params.clientId;

  const me = useMe();
  const cat = useCatalogos();
  const criar = useCriarViagem();
  const extrairTicket = useExtrairTicket();

  const [form, setForm] = useState<FormShape>(empty);
  const [foto, setFoto] = useState<FotoComprimida | null>(null);
  const [sugestoesIa, setSugestoesIa] = useState<ExtrairTicketResult | null>(null);
  const [ocrCampos, setOcrCampos] = useState<Set<string>>(new Set());
  const [ocrConfidence, setOcrConfidence] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [kmEditadoManual, setKmEditadoManual] = useState(false);
  const [hidratando, setHidratando] = useState<boolean>(modoEdit);
  const [pendingOriginal, setPendingOriginal] = useState<PendingViagem | null>(null);

  const rota = useCalcularRota(form.localCargaId, form.localDescargaId);

  useEffect(() => {
    if (!modoEdit) return;
    let alive = true;
    void (async () => {
      const list = await listPendingViagens();
      const item = list.find((x) => x.clientId === params.clientId);
      if (!alive) return;
      if (!item) {
        void showAlert({
          title: "Viagem não encontrada",
          message: "Essa viagem pode ter sido sincronizada ou excluída.",
          variant: "warning",
        }).then(() => navigate(-1));
        return;
      }
      setPendingOriginal(item);
      const p = item.payload as Record<string, unknown>;
      setForm({
        veiculoId: String(p.veiculoId ?? ""),
        clienteId: String(p.clienteId ?? ""),
        materialId: String(p.materialId ?? ""),
        data: typeof p.data === "string" ? p.data.slice(0, 10) : hojeISO(),
        toneladas: numToStr(p.toneladas),
        ticket: String(p.ticket ?? ""),
        km: numToStr(p.km),
        localCargaId: String(p.localCargaId ?? ""),
        localDescargaId: String(p.localDescargaId ?? ""),
        valorPedagio: p.valorPedagioTotal != null ? numToStr(p.valorPedagioTotal) : "",
        observacao: String(p.observacao ?? ""),
      });
      if (item.fotoBlob && item.fotoMime) {
        const dataUrl = await blobParaDataUrl(item.fotoBlob);
        const base64 = dataUrl.split(",")[1] ?? "";
        setFoto({ blob: item.fotoBlob, mime: item.fotoMime, dataUrl, base64 });
      }
      setKmEditadoManual(true);
      setHidratando(false);
    })();
    return () => {
      alive = false;
    };
  }, [modoEdit, params.clientId, navigate]);

  // Auto-preenche KM com rota OSRM se motorista não editou
  useEffect(() => {
    if (kmEditadoManual) return;
    if (!rota.data || rota.data.km === null) return;
    const novoKm = rota.data.km;
    setForm((f) => (f.km === novoKm ? f : { ...f, km: novoKm }));
  }, [rota.data, kmEditadoManual]);

  // Placa default
  useEffect(() => {
    if (me.data?.veiculoDefaultId && !form.veiculoId) {
      setForm((f) => ({ ...f, veiculoId: me.data!.veiculoDefaultId! }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me.data]);

  const todosLocais = useMemo<Local[]>(() => cat.data?.locais ?? [], [cat.data?.locais]);

  // Nome do local de descarga selecionado (pra DescargaPorGps mostrar quando edita)
  const nomeDescargaSelecionado = useMemo(() => {
    if (!form.localDescargaId) return undefined;
    return todosLocais.find((l) => l.id === form.localDescargaId)?.nome;
  }, [form.localDescargaId, todosLocais]);

  // Coords do local de carga selecionado (pra DescargaPorGps alertar se motorista
  // tá lançando descarga no mesmo lugar da carga)
  const localCargaCoords = useMemo(() => {
    if (!form.localCargaId) return null;
    const l = todosLocais.find((x) => x.id === form.localCargaId);
    if (!l || l.lat == null || l.lng == null) return null;
    return { lat: l.lat, lng: l.lng, nome: l.nome };
  }, [form.localCargaId, todosLocais]);

  const veiculoOptions: SelectOption[] = useMemo(
    () =>
      (cat.data?.veiculos ?? []).map((v) => ({
        value: v.id,
        label: v.placa,
        sublabel: v.modelo ?? undefined,
      })),
    [cat.data?.veiculos],
  );

  const clienteOptions: SelectOption[] = useMemo(
    () =>
      (cat.data?.clientes ?? []).map((o) => ({
        value: o.id,
        label: o.nome,
        sublabel: o.empresa.nome,
      })),
    [cat.data?.clientes],
  );

  const materialOptions: SelectOption[] = useMemo(
    () => (cat.data?.materiais ?? []).map((m) => ({ value: m.id, label: m.nome })),
    [cat.data?.materiais],
  );

  // Apenas locais de carga listados pro Select. Descarga vai via DescargaPorGps.
  const locaisFiltrados = useMemo(() => {
    const clienteId = form.clienteId || null;
    const noCliente = todosLocais.filter(
      (l) =>
        !clienteId || l.clienteIds.length === 0 || l.clienteIds.includes(clienteId),
    );
    const opt = (l: Local): SelectOption => ({
      value: l.id,
      label: l.nome,
      sublabel: `${l.cidade}/${l.uf}`,
    });
    return {
      carga: noCliente.filter((l) => l.tipo === "CARGA" || l.tipo === "AMBOS").map(opt),
    };
  }, [todosLocais, form.clienteId]);

  function update<K extends keyof FormShape>(k: K, v: FormShape[K]) {
    if (k === "km") setKmEditadoManual(true);
    setForm((f) => ({ ...f, [k]: v }));
    setOcrCampos((s) => {
      if (!s.has(k as string)) return s;
      const next = new Set(s);
      next.delete(k as string);
      return next;
    });
  }

  function aplicarSugestoesIa(s: ExtrairTicketResult) {
    const aplicados = new Set<string>();
    setForm((f) => {
      const next = { ...f };
      if (!next.ticket && s.ticket) {
        next.ticket = s.ticket.toUpperCase();
        aplicados.add("ticket");
      }
      if (!next.toneladas.trim() && typeof s.toneladas === "number") {
        next.toneladas = String(s.toneladas).replace(".", ",");
        aplicados.add("toneladas");
      }
      if (!next.km.trim() && typeof s.km === "number") {
        next.km = String(s.km).replace(".", ",");
        aplicados.add("km");
      }
      if (!next.clienteId && s.clienteId) {
        next.clienteId = s.clienteId;
        aplicados.add("clienteId");
      }
      if (!next.materialId && s.materialId) {
        next.materialId = s.materialId;
        aplicados.add("materialId");
      }
      if (!next.veiculoId && s.veiculoId) {
        next.veiculoId = s.veiculoId;
        aplicados.add("veiculoId");
      }
      if (s.data && next.data === hojeISO()) {
        next.data = s.data;
        aplicados.add("data");
      }
      return next;
    });
    setOcrCampos(aplicados);
    setOcrConfidence(s.confidence);
  }

  function validar(): string | null {
    if (!form.veiculoId) return "Escolha a placa.";
    if (!form.clienteId) return "Escolha o cliente.";
    if (!form.materialId) return "Escolha o material.";
    if (!form.localCargaId) return "Escolha o local de carga.";
    if (!form.localDescargaId) return "Escolha o local de descarga.";
    if (!form.toneladas.trim()) return "Informe as toneladas.";
    if (!form.ticket.trim()) return "Informe o ticket.";
    if (!form.km.trim()) return "Informe os km rodados.";
    return null;
  }

  async function salvar() {
    setErro(null);
    const v = validar();
    if (v) {
      setErro(v);
      return;
    }
    let dataFinal = form.data;
    if (dataFinal !== hojeISO()) {
      const escolha = await showAlert({
        title: "Data diferente de hoje",
        message: `A viagem está marcada como ${fmtDataBR(dataFinal)}. Hoje é ${fmtDataBR(hojeISO())}. Tem certeza?`,
        variant: "warning",
        buttons: [
          { label: "Cancelar", value: "cancel", style: "cancel" },
          { label: "Marcar hoje", value: "today" },
          { label: "Confirmar", value: "ok" },
        ],
      });
      if (escolha === "cancel" || escolha === null) return;
      if (escolha === "today") {
        dataFinal = hojeISO();
        setForm((f) => ({ ...f, data: dataFinal }));
      }
    }
    setSubmitting(true);
    try {
      const orig = pendingOriginal?.payload as Record<string, unknown> | undefined;
      const fotoMudou = modoEdit && !!foto && foto.blob !== pendingOriginal?.fotoBlob;
      const preservaFotoKey =
        modoEdit && !fotoMudou && typeof orig?.fotoKey === "string"
          ? { fotoKey: orig.fotoKey as string }
          : {};

      const payload = {
        clientId: modoEdit ? params.clientId! : gerarClientId(),
        veiculoId: form.veiculoId,
        clienteId: form.clienteId,
        materialId: form.materialId,
        data: dataFinal,
        toneladas: parseFloat(form.toneladas.replace(",", ".")),
        ticket: form.ticket.trim(),
        km: parseFloat(form.km.replace(",", ".")),
        kmCalculado:
          rota.data && "km" in rota.data && rota.data.km !== null
            ? parseFloat(String(rota.data.km))
            : undefined,
        localCargaId: form.localCargaId,
        localDescargaId: form.localDescargaId,
        valorPedagioTotal: form.valorPedagio
          ? parseFloat(form.valorPedagio.replace(",", "."))
          : undefined,
        observacao: form.observacao.trim() || undefined,
        criadoOfflineEm:
          modoEdit && typeof orig?.criadoOfflineEm === "string"
            ? (orig.criadoOfflineEm as string)
            : new Date().toISOString(),
        ...(ocrCampos.size > 0
          ? {
              ocrCampos: Array.from(ocrCampos),
              ocrConfidence: ocrConfidence ?? undefined,
            }
          : {}),
        ...preservaFotoKey,
      };

      const parsed = CriarViagemInput.safeParse(payload);
      if (!parsed.success) {
        setErro(humanizeZodError(parsed.error));
        setSubmitting(false);
        return;
      }

      if (modoEdit) {
        const novaFoto = fotoMudou && foto ? { blob: foto.blob, mime: foto.mime } : undefined;
        const res = await atualizarViagemPendente({
          clientId: params.clientId!,
          payload,
          foto: novaFoto,
        });
        if (res.removed) {
          void showAlert({
            title: "Viagem já sincronizada",
            message: "Essa viagem foi enviada com sucesso enquanto você editava. Não precisa salvar de novo.",
          }).then(() => navigate(-1));
          return;
        }
      } else {
        await criar({
          payload,
          foto: foto ? { blob: foto.blob, mime: foto.mime } : undefined,
        });
      }
      navigate(-1);
    } catch (err) {
      setErro(humanizeApiError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen-safe flex-col bg-background pb-20">
      <ScreenHeader title={modoEdit ? "Editar viagem pendente" : "Nova viagem"} />

      {(hidratando || ((cat.isLoading || me.isLoading) && !cat.data && !me.data)) && (
        <div className="py-8 text-center">
          <p className="text-sm text-muted-foreground">
            {hidratando ? "Carregando viagem..." : "Carregando dados..."}
          </p>
        </div>
      )}

      {!cat.isLoading && !cat.data && (
        <div className="m-4 rounded-lg border border-warning bg-warning/15 p-4">
          <p className="font-medium text-foreground">Sem dados de catálogo</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Conecte na internet uma vez pra carregar veículos, clientes, materiais e locais.
          </p>
        </div>
      )}

      {cat.data && !hidratando && (
        <div className="space-y-4 p-4 pb-32">
          <div className="space-y-2">
            <FieldLabel label="Foto do ticket" hint="opcional, mas ajuda na conferência" />
            <PhotoCapture
              label=""
              value={foto}
              obrigatorio={false}
              onChange={(novaFoto) => {
                setFoto(novaFoto);
                setSugestoesIa(null);
                if (novaFoto && me.data?.podeUsarOcrTicket) {
                  void (async () => {
                    try {
                      const res = await extrairTicket.mutateAsync({
                        fotoBase64: novaFoto.base64,
                        mime: novaFoto.mime as "image/jpeg" | "image/png" | "image/webp",
                      });
                      if (res.confidence > 0.2) setSugestoesIa(res);
                    } catch {
                      /* silencioso */
                    }
                  })();
                }
              }}
            />
            {extrairTicket.isPending && (
              <div className="mt-2 flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-r-transparent" />
                <p className="text-sm text-muted-foreground">Lendo dados do ticket...</p>
              </div>
            )}
            {sugestoesIa && (
              <BannerSugestoesIa
                sugestoes={sugestoesIa}
                catalogos={cat.data ?? null}
                onUsar={() => {
                  aplicarSugestoesIa(sugestoesIa);
                  setSugestoesIa(null);
                }}
                onDispensar={() => setSugestoesIa(null)}
              />
            )}
          </div>

          <Field label="Placa" markOcr={ocrCampos.has("veiculoId")}>
            <Select
              value={form.veiculoId}
              onChange={(v) => update("veiculoId", v)}
              options={veiculoOptions}
              placeholder="Escolha a placa"
              searchable
              title="Placa"
            />
          </Field>

          <Field label="Data" markOcr={ocrCampos.has("data")}>
            <DateField
              value={form.data}
              onChange={(v) => update("data", v)}
              disabled={submitting}
            />
          </Field>

          <Field label="Cliente" markOcr={ocrCampos.has("clienteId")}>
            <Select
              value={form.clienteId}
              onChange={(v) => update("clienteId", v)}
              options={clienteOptions}
              placeholder="Escolha o cliente"
              searchable
              title="Cliente"
            />
          </Field>

          <Field label="Material" markOcr={ocrCampos.has("materialId")}>
            <Select
              value={form.materialId}
              onChange={(v) => update("materialId", v)}
              options={materialOptions}
              placeholder="Escolha o material"
              searchable
              title="Material"
            />
          </Field>

          <div className="flex gap-3">
            <div className="flex-1 space-y-2">
              <FieldLabel label="Toneladas" markOcr={ocrCampos.has("toneladas")} />
              <Input
                value={form.toneladas}
                onChange={(e) => update("toneladas", e.target.value)}
                inputMode="decimal"
                placeholder="0,000"
                maxLength={8}
              />
              <p className="text-xs text-muted-foreground">Em toneladas (máx 9999)</p>
            </div>
            <div className="flex-1 space-y-2">
              <FieldLabel label="Ticket" markOcr={ocrCampos.has("ticket")} />
              <Input
                value={form.ticket}
                onChange={(e) => update("ticket", e.target.value.toUpperCase())}
                placeholder="número"
                maxLength={50}
                autoCapitalize="characters"
                autoCorrect="off"
              />
            </div>
          </div>

          <Field label="Local de carga">
            <Select
              value={form.localCargaId}
              onChange={(v) => update("localCargaId", v)}
              options={locaisFiltrados.carga}
              placeholder="Escolha o local"
              searchable
              title="Local de carga"
              emptyMessage="Nenhum local de carga pra esse cliente"
            />
          </Field>

          <DescargaPorGps
            clienteId={form.clienteId || null}
            value={form.localDescargaId}
            onChange={(v) => update("localDescargaId", v)}
            nomeSelecionadoFallback={nomeDescargaSelecionado}
            localCargaCoords={localCargaCoords}
          />

          <Field label="Km rodados" markOcr={ocrCampos.has("km")}>
            <Input
              value={form.km}
              onChange={(e) => update("km", e.target.value)}
              inputMode="decimal"
              placeholder="0,00"
              maxLength={10}
            />
            {rota.data && "km" in rota.data && rota.data.km !== null && !kmEditadoManual && (
              <p className="mt-1 text-xs text-muted-foreground">
                Sugerido pela rota: {rota.data.km} km
              </p>
            )}
          </Field>

          <Field label="Valor de pedágio (opcional)">
            <Input
              value={form.valorPedagio}
              onChange={(e) => update("valorPedagio", e.target.value)}
              inputMode="decimal"
              placeholder="R$ 0,00"
              maxLength={10}
            />
          </Field>

          <Field label="Observação (opcional)">
            <textarea
              value={form.observacao}
              onChange={(e) => update("observacao", e.target.value)}
              placeholder="Algum detalhe sobre essa viagem..."
              rows={3}
              maxLength={500}
              className="w-full rounded-xl border-2 border-border bg-background p-3 text-[17px] font-medium text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
            />
          </Field>

          {erro && (
            <div className="rounded-xl border-2 border-destructive bg-destructive/10 p-3">
              <p className="text-base font-medium text-destructive whitespace-pre-line">{erro}</p>
            </div>
          )}
        </div>
      )}

      {cat.data && !hidratando && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background p-4 pb-safe">
          <Button onClick={salvar} size="xl" className="w-full" loading={submitting}>
            {submitting ? "Salvando..." : modoEdit ? "Salvar alterações" : "Salvar viagem"}
          </Button>
        </div>
      )}
    </div>
  );
}

function blobParaDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}

function Field({
  label,
  hint,
  markOcr,
  children,
}: {
  label: string;
  hint?: string;
  markOcr?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <FieldLabel label={label} hint={hint} markOcr={markOcr} />
      {children}
    </div>
  );
}

function FieldLabel({ label, hint, markOcr }: { label: string; hint?: string; markOcr?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <Label>{label}</Label>
      {markOcr && (
        <span className="inline-flex items-center gap-1 rounded-md bg-primary/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-primary">
          <Sparkles size={10} /> IA
        </span>
      )}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  );
}

function BannerSugestoesIa({
  sugestoes,
  catalogos,
  onUsar,
  onDispensar,
}: {
  sugestoes: ExtrairTicketResult;
  catalogos: Catalogos | null;
  onUsar: () => void;
  onDispensar: () => void;
}) {
  const linhas = useMemo(() => {
    const out: string[] = [];
    if (sugestoes.ticket) out.push(`Ticket: ${sugestoes.ticket}`);
    if (typeof sugestoes.toneladas === "number")
      out.push(`Toneladas: ${sugestoes.toneladas}`);
    if (typeof sugestoes.km === "number") out.push(`Km: ${sugestoes.km}`);
    if (sugestoes.data) out.push(`Data: ${sugestoes.data}`);
    if (sugestoes.clienteId && catalogos) {
      const c = catalogos.clientes.find((x) => x.id === sugestoes.clienteId);
      if (c) out.push(`Cliente: ${c.nome}`);
    } else if (sugestoes.clienteSugerido) {
      out.push(`Cliente (não casou): ${sugestoes.clienteSugerido}`);
    }
    if (sugestoes.materialId && catalogos) {
      const m = catalogos.materiais.find((x) => x.id === sugestoes.materialId);
      if (m) out.push(`Material: ${m.nome}`);
    } else if (sugestoes.materialSugerido) {
      out.push(`Material (não casou): ${sugestoes.materialSugerido}`);
    }
    if (sugestoes.veiculoId && catalogos) {
      const v = catalogos.veiculos.find((x) => x.id === sugestoes.veiculoId);
      if (v) out.push(`Placa: ${v.placa}`);
    } else if (sugestoes.placaSugerida) {
      out.push(`Placa (não casou): ${sugestoes.placaSugerida}`);
    }
    return out;
  }, [sugestoes, catalogos]);

  return (
    <div className="mt-3 rounded-2xl border-2 border-primary/40 bg-primary/10 p-3">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Sparkles size={18} />
        </div>
        <div className="flex-1">
          <p className="text-sm font-bold text-foreground">Li o ticket por IA</p>
          <p className="text-xs text-muted-foreground">
            Confiança {Math.round((sugestoes.confidence ?? 0) * 100)}% · revisa antes de aplicar
          </p>
        </div>
        <button
          type="button"
          onClick={onDispensar}
          aria-label="Dispensar sugestões"
          className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground active:opacity-75"
        >
          <X size={16} />
        </button>
      </div>
      <ul className="mt-2 ml-12 list-disc text-sm text-foreground space-y-0.5">
        {linhas.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>
      <Button onClick={onUsar} className="mt-3 w-full" size="sm">
        <Check size={16} /> Aplicar sugestões
      </Button>
    </div>
  );
}
