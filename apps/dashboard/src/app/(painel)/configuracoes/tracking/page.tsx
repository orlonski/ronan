"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fetchApi, useAuthToken } from "@/lib/client-api";

type ConfigTracking = {
  id: string;
  distanciaMinMetros: number;
  intervaloMaxSegundos: number;
  precisaoAlta: boolean;
  accuracyMaxMetros: number;
  velocidadeMaxKmh: number;
  autoFinalizarHoras: number;
  detectorAtivado: boolean;
  detectorVelocidadeKmh: number;
  detectorLeituras: number;
};

const PATH = "/admin/tracking-config";

export default function TrackingConfigPage() {
  const token = useAuthToken();
  const qc = useQueryClient();

  const cfg = useQuery({
    queryKey: [PATH],
    enabled: !!token,
    queryFn: () => fetchApi<ConfigTracking>(PATH, { token }),
  });

  const [form, setForm] = useState<ConfigTracking | null>(null);

  useEffect(() => {
    if (cfg.data && !form) setForm(cfg.data);
  }, [cfg.data, form]);

  const update = useMutation({
    mutationFn: (body: Partial<ConfigTracking>) =>
      fetchApi<ConfigTracking>(PATH, {
        method: "PUT",
        body: JSON.stringify(body),
        token,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [PATH] });
    },
  });
  if (!form) return <p className="text-sm text-muted-foreground">Carregando…</p>;

  function set<K extends keyof ConfigTracking>(k: K, v: ConfigTracking[K]) {
    setForm((f) => (f ? { ...f, [k]: v } : f));
  }

  async function salvar(ev: React.FormEvent) {
    ev.preventDefault();
    if (!form) return;
    const { id: _id, ...body } = form;
    await update.mutateAsync(body);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Configuração do tracking GPS</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Ajustes globais aplicados a todos os motoristas. Mudanças entram em
          vigor na próxima viagem que cada motorista iniciar.
        </p>
      </div>

      <form onSubmit={salvar} className="space-y-4">
        <Card className="space-y-4 p-5">
          <h2 className="text-base font-semibold">Captura GPS</h2>

          <Field
            label="Distância mínima entre pontos (metros)"
            help="GPS captura quando o motorista anda pelo menos N metros. Valores menores = mais detalhe + mais bateria."
          >
            <NumInput
              value={form.distanciaMinMetros}
              onChange={(v) => set("distanciaMinMetros", v)}
              min={5}
              max={500}
            />
          </Field>

          <Field
            label="Intervalo máximo entre pontos (segundos)"
            help="Mesmo parado, captura ao menos 1 ponto a cada N segundos. Funciona como fallback do distância."
          >
            <NumInput
              value={form.intervaloMaxSegundos}
              onChange={(v) => set("intervaloMaxSegundos", v)}
              min={10}
              max={300}
            />
          </Field>

          <Field
            label="Precisão alta"
            help="Ativa modo High accuracy do GPS (~5-10m de erro). Sem isso, usa Balanced (~30-50m). High consome mais bateria."
          >
            <Toggle
              value={form.precisaoAlta}
              onChange={(v) => set("precisaoAlta", v)}
            />
          </Field>
        </Card>

        <Card className="space-y-4 p-5">
          <h2 className="text-base font-semibold">Filtros (descarta pontos ruins)</h2>

          <Field
            label="Accuracy máxima aceita (metros)"
            help="Pontos com erro maior que isso são descartados (GPS confuso, indoor, dentro de prédio)."
          >
            <NumInput
              value={form.accuracyMaxMetros}
              onChange={(v) => set("accuracyMaxMetros", v)}
              min={20}
              max={500}
            />
          </Field>

          <Field
            label="Velocidade máxima aceita (km/h)"
            help="Pontos com velocidade maior são descartados (jump impossível por erro do satélite)."
          >
            <NumInput
              value={form.velocidadeMaxKmh}
              onChange={(v) => set("velocidadeMaxKmh", v)}
              min={50}
              max={400}
            />
          </Field>
        </Card>

        <Card className="space-y-4 p-5">
          <h2 className="text-base font-semibold">Auto-finalização</h2>

          <Field
            label="Notificar finalizar após X horas sem novo ponto"
            help="Se o motorista esquecer de finalizar, manda notificação depois desse tempo. Não finaliza sozinho."
          >
            <NumInput
              value={form.autoFinalizarHoras}
              onChange={(v) => set("autoFinalizarHoras", v)}
              min={1}
              max={24}
            />
          </Field>
        </Card>

        <Card className="space-y-4 p-5">
          <h2 className="text-base font-semibold">Detector híbrido (lembrete automático)</h2>

          <Field
            label="Ativado"
            help="Se ligado, app monitora movimento de carro em background e lembra o motorista de iniciar tracking."
          >
            <Toggle
              value={form.detectorAtivado}
              onChange={(v) => set("detectorAtivado", v)}
            />
          </Field>

          <Field
            label="Velocidade pra disparar (km/h)"
            help="Detector dispara quando velocidade fica acima desse valor. Em região urbana, pode subir pra evitar trânsito."
          >
            <NumInput
              value={form.detectorVelocidadeKmh}
              onChange={(v) => set("detectorVelocidadeKmh", v)}
              min={10}
              max={120}
              disabled={!form.detectorAtivado}
            />
          </Field>

          <Field
            label="Leituras consecutivas"
            help="Quantas leituras com velocidade acima do limite seguidas pra disparar. Mais = menos falso positivo."
          >
            <NumInput
              value={form.detectorLeituras}
              onChange={(v) => set("detectorLeituras", v)}
              min={1}
              max={10}
              disabled={!form.detectorAtivado}
            />
          </Field>
        </Card>

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={update.isPending}>
            <Save className="mr-2 h-4 w-4" />
            {update.isPending ? "Salvando…" : "Salvar configuração"}
          </Button>
          {update.isSuccess && (
            <span className="text-sm text-green-600">✓ Salvo</span>
          )}
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {children}
      {help && <p className="text-xs text-muted-foreground">{help}</p>}
    </div>
  );
}

function NumInput({
  value,
  onChange,
  min,
  max,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  disabled?: boolean;
}) {
  return (
    <Input
      type="number"
      value={value}
      onChange={(e) => {
        const n = Number(e.target.value);
        if (!Number.isNaN(n)) onChange(n);
      }}
      min={min}
      max={max}
      disabled={disabled}
      className="max-w-[200px]"
    />
  );
}

function Toggle({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
        value ? "bg-primary" : "bg-muted"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          value ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}
