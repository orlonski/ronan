"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save } from "lucide-react";
import type { ModoForcaAtualizacao } from "@ronan/shared-types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { MotoristaComboboxMulti } from "@/components/fk-comboboxes";
import { Permitido } from "@/components/requer-tela";
import { fetchApi, useAuthToken } from "@/lib/client-api";

type Config = {
  id: string;
  modo: ModoForcaAtualizacao;
  versaoMinimaIos: string | null;
  versaoMinimaAndroid: string | null;
  motoristasAlvo: string[];
};

type Detectada = { versao: string; motoristas: number } | null;
type Resposta = {
  config: Config;
  detectadas: { ios: Detectada; android: Detectada };
};

const PATH = "/admin/forca-atualizacao";

const MODO_LABEL: Record<ModoForcaAtualizacao, string> = {
  off: "Desligado (nunca age)",
  observar: "Observar (detecta, não age)",
  nudge: "Avisar (aviso dispensável)",
  bloquear: "Bloquear (tela cheia obrigatória)",
};

export default function ForcaAtualizacaoPage() {
  const token = useAuthToken();
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: [PATH],
    enabled: !!token,
    queryFn: () => fetchApi<Resposta>(PATH, { token }),
  });

  const [form, setForm] = useState<Config | null>(null);
  useEffect(() => {
    if (q.data?.config && !form) setForm(q.data.config);
  }, [q.data, form]);

  const update = useMutation({
    mutationFn: (body: Partial<Config>) =>
      fetchApi<Config>(PATH, {
        method: "PUT",
        body: JSON.stringify(body),
        token,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [PATH] });
    },
  });

  if (!form) return <p className="text-sm text-muted-foreground">Carregando…</p>;

  function set<K extends keyof Config>(k: K, v: Config[K]) {
    setForm((f) => (f ? { ...f, [k]: v } : f));
  }

  async function salvar(ev: React.FormEvent) {
    ev.preventDefault();
    if (!form) return;
    await update.mutateAsync({
      modo: form.modo,
      // String vazia = limpa o override (volta pro automático).
      versaoMinimaAndroid: form.versaoMinimaAndroid?.trim() || null,
      versaoMinimaIos: form.versaoMinimaIos?.trim() || null,
      motoristasAlvo: form.motoristasAlvo,
    });
  }

  const det = q.data?.detectadas;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Força-atualização do app</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Obriga o motorista com app desatualizado a atualizar pela loja. A
          comparação é pela versão de marketing (ex: 1.0.3). Offline nunca
          bloqueia (o app é fail-open).
        </p>
      </div>

      <form onSubmit={salvar} className="space-y-4">
        <Card className="space-y-4 p-5">
          <h2 className="text-base font-semibold">Comportamento</h2>

          <Field
            label="Modo"
            help="Off/Observar = nunca bloqueia (kill-switch). Avisar = aviso dispensável. Bloquear = tela cheia obrigatória. Reversível na hora."
          >
            <Select
              value={form.modo}
              onChange={(e) => set("modo", e.target.value as ModoForcaAtualizacao)}
              className="max-w-[360px]"
            >
              {(
                Object.keys(MODO_LABEL) as ModoForcaAtualizacao[]
              ).map((m) => (
                <option key={m} value={m}>
                  {MODO_LABEL[m]}
                </option>
              ))}
            </Select>
          </Field>
        </Card>

        <Card className="space-y-4 p-5">
          <h2 className="text-base font-semibold">Versão mínima (piso)</h2>
          <p className="text-xs text-muted-foreground">
            Abaixo desta versão, o app age conforme o modo. Vazio = usa a maior
            versão detectada automaticamente. Recomendado: defina o piso na mão
            (previsível).
          </p>

          <Field
            label="Android"
            help={
              det?.android
                ? `Detectado em circulação: ${det.android.versao} (em ${det.android.motoristas} motorista(s)).`
                : "Nenhuma versão firmou ainda (precisa de ≥2 motoristas na janela)."
            }
          >
            <Input
              value={form.versaoMinimaAndroid ?? ""}
              onChange={(e) => set("versaoMinimaAndroid", e.target.value)}
              placeholder="ex: 1.0.5"
              className="max-w-[200px]"
            />
          </Field>

          <Field
            label="iOS"
            help={
              det?.ios
                ? `Detectado em circulação: ${det.ios.versao} (em ${det.ios.motoristas} motorista(s)).`
                : "Nenhuma versão firmou ainda."
            }
          >
            <Input
              value={form.versaoMinimaIos ?? ""}
              onChange={(e) => set("versaoMinimaIos", e.target.value)}
              placeholder="ex: 1.0.5"
              className="max-w-[200px]"
            />
          </Field>
        </Card>

        <Card className="space-y-4 p-5">
          <h2 className="text-base font-semibold">Allowlist de teste</h2>
          <p className="text-xs text-muted-foreground">
            Se marcar motoristas aqui, <b>só eles</b> são avaliados (o resto da
            frota nunca age). <b>Vazio = vale pra todos.</b> Use pra testar o
            bloqueio em produção mirando só a sua conta, sem risco à frota.
          </p>
          <MotoristaComboboxMulti
            value={form.motoristasAlvo}
            onChange={(v) => set("motoristasAlvo", v)}
          />
        </Card>

        <Permitido chave="config-forca-atualizacao.editar">
          <Button type="submit" disabled={update.isPending}>
            <Save className="mr-2 h-4 w-4" />
            {update.isPending ? "Salvando…" : "Salvar"}
          </Button>
        </Permitido>
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
