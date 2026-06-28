"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fetchApi, useAuthToken } from "@/lib/client-api";

type ConfigBuscaLocais = {
  id: string;
  raioInicialM: number;
  raioAmpliadoM: number;
  gpsAlvoMetros: number;
  gpsMaxSegundos: number;
  gpsLimiteSinalFracoM: number;
};

const PATH = "/admin/busca-locais-config";

export default function BuscaLocaisConfigPage() {
  const { data: session } = useSession();
  const token = useAuthToken();
  const qc = useQueryClient();

  const cfg = useQuery({
    queryKey: [PATH, token],
    enabled: !!token,
    queryFn: () => fetchApi<ConfigBuscaLocais>(PATH, { token }),
  });

  const [form, setForm] = useState<ConfigBuscaLocais | null>(null);

  useEffect(() => {
    if (cfg.data && !form) setForm(cfg.data);
  }, [cfg.data, form]);

  const update = useMutation({
    mutationFn: (body: Partial<ConfigBuscaLocais>) =>
      fetchApi<ConfigBuscaLocais>(PATH, {
        method: "PUT",
        body: JSON.stringify(body),
        token,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [PATH] });
    },
  });

  if (session?.user?.perfil !== "ADMIN") {
    return (
      <div className="rounded-md border bg-muted/30 p-6">
        <p className="text-sm text-muted-foreground">
          Acesso restrito a administradores.
        </p>
      </div>
    );
  }

  if (!form) return <p className="text-sm text-muted-foreground">Carregando…</p>;

  function set<K extends keyof ConfigBuscaLocais>(k: K, v: ConfigBuscaLocais[K]) {
    setForm((f) => (f ? { ...f, [k]: v } : f));
  }

  const ampliadoInvalido = form.raioAmpliadoM < form.raioInicialM;

  async function salvar(ev: React.FormEvent) {
    ev.preventDefault();
    if (!form || ampliadoInvalido) return;
    const { id: _id, ...body } = form;
    await update.mutateAsync(body);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Busca de local de descarga</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Quando o motorista clica em “Estou no local de descarga”, o app procura
          locais cadastrados em duas etapas. Primeiro no raio inicial (apertado);
          se não achar nada, tenta o raio ampliado e <strong>sugere</strong> o que
          encontrar — sem selecionar sozinho. Mudanças valem na próxima busca.
        </p>
      </div>

      <form onSubmit={salvar} className="space-y-4">
        <Card className="space-y-4 p-5">
          <Field
            label="Raio inicial (metros)"
            help="1ª tentativa, apertada. Se achar 1 local aqui, o app seleciona direto — então mantenha pequeno pra não confundir locais próximos um do outro."
          >
            <NumInput
              value={form.raioInicialM}
              onChange={(v) => set("raioInicialM", v)}
              min={20}
              max={2000}
            />
          </Field>

          <Field
            label="Raio ampliado (metros)"
            help="2ª tentativa, usada só quando o raio inicial não acha nada. O resultado vira sugestão — o motorista precisa confirmar pra selecionar."
          >
            <NumInput
              value={form.raioAmpliadoM}
              onChange={(v) => set("raioAmpliadoM", v)}
              min={20}
              max={2000}
            />
          </Field>

          {ampliadoInvalido && (
            <p className="text-sm text-destructive">
              O raio ampliado deve ser maior ou igual ao raio inicial.
            </p>
          )}
        </Card>

        <Card className="space-y-4 p-5">
          <div>
            <h2 className="text-base font-semibold">Captura de GPS</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Quando o motorista toca “Estou no local de descarga”, o app amostra
              o GPS por alguns segundos pra pegar a melhor posição. Vale na
              próxima captura (o app revalida a config a cada ~30 min).
            </p>
          </div>

          <Field
            label="Precisão alvo (metros)"
            help="Assim que o GPS atinge essa precisão, a captura encerra na hora. Menor = espera um sinal melhor (pode demorar um pouco mais)."
          >
            <NumInput
              value={form.gpsAlvoMetros}
              onChange={(v) => set("gpsAlvoMetros", v)}
              min={3}
              max={100}
            />
          </Field>

          <Field
            label="Tempo máximo (segundos)"
            help="Limite de espera pela precisão alvo. Estourou o tempo, usa a melhor leitura que conseguiu até ali."
          >
            <NumInput
              value={form.gpsMaxSegundos}
              onChange={(v) => set("gpsMaxSegundos", v)}
              min={3}
              max={60}
            />
          </Field>

          <Field
            label="Limite de sinal fraco (metros)"
            help="Acima disso, o app avisa “sinal fraco” (deixa tentar de novo) e o dashboard marca a coordenada em âmbar pra revisão."
          >
            <NumInput
              value={form.gpsLimiteSinalFracoM}
              onChange={(v) => set("gpsLimiteSinalFracoM", v)}
              min={10}
              max={500}
            />
          </Field>
        </Card>

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={update.isPending || ampliadoInvalido}>
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
