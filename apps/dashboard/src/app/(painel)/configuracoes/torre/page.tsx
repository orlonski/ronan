"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save } from "lucide-react";
import { toast } from "sonner";
import { RequerTela } from "@/components/requer-tela";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { fetchApi, useAuthToken } from "@/lib/client-api";
import { usePermissoes } from "@/lib/permissoes";
import { AbasDaTela } from "@/components/abas-da-tela";

type ConfigTorre = {
  id: string;
  paradaLongaMin: number;
  paradaLongaAltaMin: number;
  viagemEsquecidaMin: number;
  semSinalMin: number;
  horaInicio: number;
  horaFim: number;
  notificaDomingo: boolean;
  fecharAbandonadaHoras: number;
};

const PATH = "/admin/torre/config";

export default function TorreConfigPage() {
  return (
    <RequerTela chave="programacao.ver">
      <Conteudo />
    </RequerTela>
  );
}

function Conteudo() {
  const token = useAuthToken();
  const qc = useQueryClient();
  const { temPermissao } = usePermissoes();
  const podeEditar = temPermissao("programacao.editar");

  const cfg = useQuery({
    queryKey: [PATH],
    enabled: !!token,
    queryFn: () => fetchApi<ConfigTorre>(PATH, { token }),
  });

  const [form, setForm] = useState<ConfigTorre | null>(null);
  useEffect(() => {
    if (cfg.data && !form) setForm(cfg.data);
  }, [cfg.data, form]);

  const update = useMutation({
    mutationFn: (body: Partial<ConfigTorre>) =>
      fetchApi<ConfigTorre>(PATH, { method: "PUT", body: JSON.stringify(body), token }),
    onSuccess: () => {
      toast.success("Régua da torre salva.");
      void qc.invalidateQueries({ queryKey: [PATH] });
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Não deu pra salvar."),
  });

  if (!form) return <p className="text-sm text-muted-foreground">Carregando…</p>;

  function set<K extends keyof ConfigTorre>(k: K, v: ConfigTorre[K]) {
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
      <AbasDaTela grupo="torre" />
      <div>
        <h1 className="text-2xl font-bold">Quando a torre avisa</h1>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          Quando uma viagem em curso vira alerta, e quando o alerta vira aviso na
          sua caixa. Pedreira e obra não têm o mesmo relógio — 2h na fila de uma
          pedreira é terça-feira, numa entrega urbana é problema.
        </p>
      </div>

      <form onSubmit={salvar} className="space-y-4">
        <Card className="space-y-4 p-5">
          <h2 className="text-base font-semibold">Viagem sem novidade</h2>

          <Field
            label="Primeiro aviso (minutos sem nenhuma etapa)"
            help="Aparece na torre, sem mandar notificação. É a faixa de fila, almoço e pedreira."
          >
            <NumInput
              value={form.paradaLongaMin}
              onChange={(v) => set("paradaLongaMin", v)}
              min={15}
              max={1440}
              disabled={!podeEditar}
            />
          </Field>

          <Field
            label="Vira urgente (minutos sem nenhuma etapa)"
            help="A partir daqui o alerta fica vermelho e manda UMA notificação. Só volta a avisar se piorar de novo."
          >
            <NumInput
              value={form.paradaLongaAltaMin}
              onChange={(v) => set("paradaLongaAltaMin", v)}
              min={15}
              max={2880}
              disabled={!podeEditar}
            />
          </Field>

          <Field
            label="Teto de idade (minutos)"
            help="Passado isso, a viagem deixa de ser problema de operação e vira 'ficou aberta': sai da fila de urgência e nunca notifica. Ninguém descobre nada ligando pro motorista de três dias atrás."
          >
            <NumInput
              value={form.viagemEsquecidaMin}
              onChange={(v) => set("viagemEsquecidaMin", v)}
              min={60}
              max={10080}
              disabled={!podeEditar}
            />
          </Field>

          <Field
            label="Sem posição de GPS (minutos)"
            help="Só vale pra quem usa tracking. Nunca notifica — fica na tela."
          >
            <NumInput
              value={form.semSinalMin}
              onChange={(v) => set("semSinalMin", v)}
              min={15}
              max={1440}
              disabled={!podeEditar}
            />
          </Field>
        </Card>

        <Card className="space-y-4 p-5">
          <h2 className="text-base font-semibold">Quando pode avisar</h2>
          <p className="text-sm text-muted-foreground">
            O alerta aparece na torre em qualquer hora. A janela segura só a
            notificação — quem abrir a torre às 5h vê tudo que aconteceu de
            madrugada.
          </p>

          <div className="flex flex-wrap items-end gap-4">
            <Field label="Das">
              <HoraInput
                value={form.horaInicio}
                onChange={(v) => set("horaInicio", v)}
                disabled={!podeEditar}
              />
            </Field>
            <Field label="Até">
              <HoraInput
                value={form.horaFim}
                onChange={(v) => set("horaFim", v)}
                disabled={!podeEditar}
              />
            </Field>
          </div>

          <Field
            label="Avisar aos domingos"
            help="Caminhão roda no domingo, mas nem toda operação tem quem atenda."
          >
            <Toggle
              value={form.notificaDomingo}
              onChange={(v) => set("notificaDomingo", v)}
              disabled={!podeEditar}
            />
          </Field>
        </Card>

        <Card className="space-y-4 p-5">
          <h2 className="text-base font-semibold">Fechar viagem esquecida sozinho</h2>

          <Field
            label="Fechar depois de (horas) — 0 desliga"
            help="A viagem vai pra Viagens como incompleta, com os eventos e as fotos que já tem, e o conferente completa o que falta. Nada é apagado. Desligado, ela fica na torre esperando alguém fechar no botão."
          >
            <NumInput
              value={form.fecharAbandonadaHoras}
              onChange={(v) => set("fecharAbandonadaHoras", v)}
              min={0}
              max={720}
              disabled={!podeEditar}
            />
          </Field>
        </Card>

        {podeEditar && (
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={update.isPending}>
              <Save className="mr-2 h-4 w-4" />
              {update.isPending ? "Salvando…" : "Salvar régua"}
            </Button>
          </div>
        )}
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
      {help && <p className="max-w-prose text-xs text-muted-foreground">{help}</p>}
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

function HoraInput({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <Select
      value={String(value)}
      onChange={(e) => onChange(Number(e.target.value))}
      disabled={disabled}
      className="max-w-[120px]"
    >
      {Array.from({ length: 24 }, (_, h) => (
        <option key={h} value={h}>
          {String(h).padStart(2, "0")}:00
        </option>
      ))}
    </Select>
  );
}

function Toggle({
  value,
  onChange,
  disabled,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!value)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 ${
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
