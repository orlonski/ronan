import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Check, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { PhotoCapture } from "@/components/photo-capture";
import { LocalNovoModal } from "@/components/local-novo-modal";
import { useCatalogos, useCriarViagem, useMe } from "@/lib/queries";

type FormShape = {
  veiculoId: string;
  obraId: string;
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

const today = () => new Date().toISOString().slice(0, 10);

const empty: FormShape = {
  veiculoId: "",
  obraId: "",
  materialId: "",
  data: today(),
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
  const me = useMe();
  const cat = useCatalogos();
  const criar = useCriarViagem();

  const [form, setForm] = useState<FormShape>(empty);
  const [foto, setFoto] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalLocal, setModalLocal] = useState<null | "carga" | "descarga">(null);

  // pré-seleciona placa default e valores iniciais quando dados chegam
  useEffect(() => {
    if (me.data?.veiculoDefaultId && !form.veiculoId) {
      setForm((f) => ({ ...f, veiculoId: me.data!.veiculoDefaultId! }));
    }
  }, [me.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const locaisFiltrados = useMemo(() => {
    if (!cat.data) return { carga: [], descarga: [] };
    const obraId = form.obraId || null;
    const naObra = cat.data.locais.filter((l) => !obraId || l.obraId === obraId || l.obraId === null);
    return {
      carga: naObra.filter((l) => l.tipo === "CARGA" || l.tipo === "AMBOS"),
      descarga: naObra.filter((l) => l.tipo === "DESCARGA" || l.tipo === "AMBOS"),
    };
  }, [cat.data, form.obraId]);

  function update<K extends keyof FormShape>(k: K, v: FormShape[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const payload = {
        clientId: crypto.randomUUID(),
        veiculoId: form.veiculoId,
        obraId: form.obraId,
        materialId: form.materialId,
        data: form.data,
        toneladas: parseFloat(form.toneladas.replace(",", ".")),
        ticket: form.ticket.trim(),
        km: parseFloat(form.km.replace(",", ".")),
        localCargaId: form.localCargaId,
        localDescargaId: form.localDescargaId,
        valorPedagioTotal: form.valorPedagio
          ? parseFloat(form.valorPedagio.replace(",", "."))
          : undefined,
        observacao: form.observacao.trim() || undefined,
        criadoOfflineEm: !navigator.onLine ? new Date().toISOString() : undefined,
      };
      await criar({
        payload,
        foto: foto ? { blob: foto, mime: foto.type || "image/jpeg" } : undefined,
      });
      navigate("/", { replace: true });
    } catch (err) {
      setError((err as Error).message || "Erro ao salvar");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-md p-4">
      <header className="mb-4 flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-xl font-semibold">Nova viagem</h1>
      </header>

      {(cat.isLoading || me.isLoading) && (
        <p className="text-sm text-muted-foreground">Carregando dados...</p>
      )}

      {cat.data && me.data && (
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="Placa">
            <Select required value={form.veiculoId} onChange={(e) => update("veiculoId", e.target.value)}>
              <option value="">— escolha —</option>
              {cat.data.veiculos.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.placa}{v.modelo ? ` · ${v.modelo}` : ""}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Data">
            <Input type="date" required value={form.data} onChange={(e) => update("data", e.target.value)} />
          </Field>

          <Field label="Obra">
            <Select required value={form.obraId} onChange={(e) => update("obraId", e.target.value)}>
              <option value="">— escolha —</option>
              {cat.data.obras.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.nome} · {o.empresaCliente.nome}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Material">
            <Select required value={form.materialId} onChange={(e) => update("materialId", e.target.value)}>
              <option value="">— escolha —</option>
              {cat.data.materiais.map((m) => (
                <option key={m.id} value={m.id}>{m.nome}</option>
              ))}
            </Select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Toneladas">
              <Input
                inputMode="decimal" required placeholder="0,000"
                value={form.toneladas} onChange={(e) => update("toneladas", e.target.value)}
              />
            </Field>
            <Field label="Ticket">
              <Input required value={form.ticket} onChange={(e) => update("ticket", e.target.value)} />
            </Field>
          </div>

          <Field label="Local de carga">
            <div className="flex gap-2">
              <Select
                required
                value={form.localCargaId}
                onChange={(e) => update("localCargaId", e.target.value)}
                className="flex-1"
              >
                <option value="">— escolha —</option>
                {locaisFiltrados.carga.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.nome} ({l.cidade}/{l.uf})
                  </option>
                ))}
              </Select>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => setModalLocal("carga")}
                title="Cadastrar local novo"
              >
                <Plus className="h-5 w-5" />
              </Button>
            </div>
          </Field>

          <Field label="Local de descarga">
            <div className="flex gap-2">
              <Select
                required
                value={form.localDescargaId}
                onChange={(e) => update("localDescargaId", e.target.value)}
                className="flex-1"
              >
                <option value="">— escolha —</option>
                {locaisFiltrados.descarga.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.nome} ({l.cidade}/{l.uf})
                  </option>
                ))}
              </Select>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => setModalLocal("descarga")}
                title="Cadastrar local novo"
              >
                <Plus className="h-5 w-5" />
              </Button>
            </div>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Km rodados">
              <Input
                inputMode="decimal" required placeholder="0,00"
                value={form.km} onChange={(e) => update("km", e.target.value)}
              />
            </Field>
            <Field label="Pedágio (R$)" hint="opcional, total da viagem">
              <Input
                inputMode="decimal" placeholder="0,00"
                value={form.valorPedagio} onChange={(e) => update("valorPedagio", e.target.value)}
              />
            </Field>
          </div>

          <Field label="Observação" hint="opcional">
            <Input value={form.observacao} onChange={(e) => update("observacao", e.target.value)} />
          </Field>

          <Field label="Foto do ticket" hint="opcional, mas ajuda na conferência">
            <PhotoCapture value={foto} onChange={setFoto} />
          </Field>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <Button type="submit" size="lg" className="w-full" disabled={submitting}>
            <Check className="h-5 w-5" />
            {submitting ? "Salvando..." : "Salvar viagem"}
          </Button>
        </form>
      )}

      <LocalNovoModal
        open={modalLocal !== null}
        onClose={() => setModalLocal(null)}
        obraId={form.obraId || undefined}
        tipoSugerido={modalLocal === "descarga" ? "DESCARGA" : modalLocal === "carga" ? "CARGA" : "AMBOS"}
        onCreated={(novo) => {
          if (modalLocal === "carga") update("localCargaId", novo.id);
          if (modalLocal === "descarga") update("localDescargaId", novo.id);
        }}
      />
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
