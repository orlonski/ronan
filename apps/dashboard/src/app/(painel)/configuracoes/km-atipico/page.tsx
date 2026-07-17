"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { fetchApi, useAuthToken } from "@/lib/client-api";

type ConfigKmAtipico = {
  id: string;
  ativo: boolean;
  desvioPct: number;
  desvioPctOsrm: number;
  amostraMinima: number;
  janelaDias: number;
  kmMinimoAvaliado: number;
};

const PATH = "/admin/km-atipico-config";

export default function KmAtipicoConfigPage() {
  const token = useAuthToken();
  const qc = useQueryClient();

  const cfg = useQuery({
    queryKey: [PATH],
    enabled: !!token,
    queryFn: () => fetchApi<ConfigKmAtipico>(PATH, { token }),
  });

  const [form, setForm] = useState<ConfigKmAtipico | null>(null);

  useEffect(() => {
    if (cfg.data && !form) setForm(cfg.data);
  }, [cfg.data, form]);

  const update = useMutation({
    mutationFn: (body: Partial<ConfigKmAtipico>) =>
      fetchApi<ConfigKmAtipico>(PATH, {
        method: "PUT",
        body: JSON.stringify(body),
        token,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [PATH] });
    },
  });
  if (!form) return <p className="text-sm text-muted-foreground">Carregando…</p>;

  function set<K extends keyof ConfigKmAtipico>(k: K, v: ConfigKmAtipico[K]) {
    setForm((f) => (f ? { ...f, [k]: v } : f));
  }

  const osrmInvalido = form.desvioPctOsrm < form.desvioPct;

  async function salvar(ev: React.FormEvent) {
    ev.preventDefault();
    if (!form || osrmInvalido) return;
    const { id: _id, ...body } = form;
    await update.mutateAsync(body);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Km atípico</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          O sistema compara o km de cada viagem com o que a frota já rodou no mesmo
          trajeto (carga → descarga) e marca quando foge do padrão. Aqui você regula
          o quanto ele tolera. Vale já na próxima viagem lançada — sem atualizar o app.
        </p>
      </div>

      <form onSubmit={salvar} className="space-y-4">
        <Card className="space-y-4 p-5">
          <Field
            label="Ligado"
            help="Desligue pra parar de avaliar e avisar (nada é marcado enquanto estiver desligado). Não precisa de deploy."
          >
            <Select
              value={form.ativo ? "sim" : "nao"}
              onChange={(e) => set("ativo", e.target.value === "sim")}
              className="max-w-[200px]"
            >
              <option value="sim">Ligado</option>
              <option value="nao">Desligado</option>
            </Select>
          </Field>
        </Card>

        <Card className="space-y-4 p-5">
          <div>
            <h2 className="text-base font-semibold">Tolerância</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              O quanto o km pode fugir da referência antes de virar “atípico”.
            </p>
          </div>

          <Field
            label="Desvio vs. histórico (%)"
            help="Comparado com a mediana das viagens da frota nesse trajeto. Ex.: 30% marca uma viagem de 130 km quando o normal é 100."
          >
            <NumInput value={form.desvioPct} onChange={(v) => set("desvioPct", v)} min={5} max={300} />
          </Field>

          <Field
            label="Desvio vs. rota calculada (%)"
            help="Usado quando ainda não há histórico suficiente e a comparação cai na rota calculada. Deixe mais folgado: o roteador não enxerga acesso de pedreira/portaria e costuma subestimar."
          >
            <NumInput
              value={form.desvioPctOsrm}
              onChange={(v) => set("desvioPctOsrm", v)}
              min={5}
              max={300}
            />
          </Field>

          {osrmInvalido && (
            <p className="text-sm text-destructive">
              O desvio da rota calculada deve ser maior ou igual ao do histórico.
            </p>
          )}

          <Field
            label="Amostra mínima (viagens)"
            help="Quantas viagens comparáveis o trajeto precisa ter pra o histórico valer como referência. Abaixo disso, compara com a rota calculada."
          >
            <NumInput
              value={form.amostraMinima}
              onChange={(v) => set("amostraMinima", v)}
              min={2}
              max={100}
            />
          </Field>

          <Field
            label="Janela (dias)"
            help="Só viagens dentro desse período pesam na média. Menor = a referência acompanha mudanças da estrada mais rápido, mas com menos amostra."
          >
            <NumInput value={form.janelaDias} onChange={(v) => set("janelaDias", v)} min={7} max={1825} />
          </Field>

          <Field
            label="Km mínimo avaliado"
            help="Viagens mais curtas que isso não são avaliadas — em trajeto curto qualquer diferencinha vira percentual grande e não significa nada."
          >
            <NumInput
              value={form.kmMinimoAvaliado}
              onChange={(v) => set("kmMinimoAvaliado", v)}
              min={0}
              max={9999}
            />
          </Field>
        </Card>

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={update.isPending || osrmInvalido}>
            <Save className="mr-2 h-4 w-4" />
            {update.isPending ? "Salvando…" : "Salvar configuração"}
          </Button>
          {update.isSuccess && <span className="text-sm text-green-600">✓ Salvo</span>}
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
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
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
      className="max-w-[200px]"
    />
  );
}
