"use client";

import { useState } from "react";
import { toast } from "sonner";
import type {
  AtualizarTipoEventoViagemInput,
  CriarTipoEventoViagemInput,
  TipoEventoViagem,
} from "@ronan/shared-types";
import { StatusToggle } from "@/components/status-toggle";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCreateResource, useUpdateResource } from "@/lib/client-api";

const PATH = "/admin/tipos-evento-viagem";

// Flags booleanas que viram switches no form (fora slug/nome/ordem/ativo).
type FlagKey =
  | "obrigatorio"
  | "repetivel"
  | "ehCarga"
  | "ehDescarga"
  | "pedeGps"
  | "pedeFoto"
  | "pedeToneladas"
  | "pedeValor"
  | "pedeTicket"
  | "pedeObservacao";

const FLAGS_MARCO: { key: FlagKey; label: string; hint: string }[] = [
  { key: "obrigatorio", label: "Obrigatório", hint: "Marco que bloqueia finalizar a viagem." },
  { key: "repetivel", label: "Repetível", hint: "Pode ser registrado várias vezes na viagem." },
  { key: "ehCarga", label: "É carga", hint: "Espelha o local de carga da viagem." },
  { key: "ehDescarga", label: "É descarga", hint: "Espelha o local de descarga da viagem." },
];

const FLAGS_PEDE: { key: FlagKey; label: string }[] = [
  { key: "pedeGps", label: "GPS" },
  { key: "pedeFoto", label: "Foto" },
  { key: "pedeToneladas", label: "Toneladas" },
  { key: "pedeValor", label: "Valor" },
  { key: "pedeTicket", label: "Ticket" },
  { key: "pedeObservacao", label: "Observação" },
];

type FormState = {
  slug: string;
  nome: string;
  ordem: string;
  ativo: boolean;
} & Record<FlagKey, boolean>;

function estadoInicial(initial?: TipoEventoViagem): FormState {
  return {
    slug: initial?.slug ?? "",
    nome: initial?.nome ?? "",
    ordem: initial ? String(initial.ordem) : "0",
    ativo: initial?.ativo ?? true,
    obrigatorio: initial?.obrigatorio ?? false,
    repetivel: initial?.repetivel ?? false,
    ehCarga: initial?.ehCarga ?? false,
    ehDescarga: initial?.ehDescarga ?? false,
    pedeGps: initial?.pedeGps ?? false,
    pedeFoto: initial?.pedeFoto ?? false,
    pedeToneladas: initial?.pedeToneladas ?? false,
    pedeValor: initial?.pedeValor ?? false,
    pedeTicket: initial?.pedeTicket ?? false,
    pedeObservacao: initial?.pedeObservacao ?? false,
  };
}

export function TipoEventoDialog({
  open,
  onOpenChange,
  initial,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Sem `initial` = criação. Com `initial` = edição (slug travado). */
  initial?: TipoEventoViagem;
}) {
  const editando = !!initial;
  const [form, setForm] = useState<FormState>(() => estadoInicial(initial));
  const [erro, setErro] = useState<string | null>(null);

  const create = useCreateResource<CriarTipoEventoViagemInput, TipoEventoViagem>(PATH, PATH);
  const update = useUpdateResource<AtualizarTipoEventoViagemInput, TipoEventoViagem>(PATH, PATH);

  // Reseta o estado do form toda vez que o dialog (re)abre.
  function handleOpenChange(next: boolean) {
    if (next) {
      setForm(estadoInicial(initial));
      setErro(null);
    }
    onOpenChange(next);
  }

  function setFlag(key: FlagKey, value: boolean) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    setErro(null);

    const nome = form.nome.trim();
    if (!nome) return setErro("Dê um nome ao evento.");

    const ordem = Number(form.ordem);
    if (!Number.isInteger(ordem) || ordem < 0) return setErro("A ordem deve ser um número inteiro (0 ou maior).");

    const flags = {
      ativo: form.ativo,
      obrigatorio: form.obrigatorio,
      repetivel: form.repetivel,
      ehCarga: form.ehCarga,
      ehDescarga: form.ehDescarga,
      pedeGps: form.pedeGps,
      pedeFoto: form.pedeFoto,
      pedeToneladas: form.pedeToneladas,
      pedeValor: form.pedeValor,
      pedeTicket: form.pedeTicket,
      pedeObservacao: form.pedeObservacao,
    };

    try {
      if (editando) {
        await update.mutateAsync({ id: initial.id, body: { nome, ordem, ...flags } });
        toast.success("Evento atualizado.");
      } else {
        const slug = form.slug.trim().toLowerCase();
        if (!/^[a-z][a-z0-9-]*$/.test(slug) || slug.length < 2) {
          return setErro("Slug inválido. Use minúsculas, kebab-case (ex: 'carga', 'pedagio').");
        }
        await create.mutateAsync({ slug, nome, ordem, ...flags });
        toast.success("Evento criado.");
      }
      onOpenChange(false);
    } catch (e) {
      setErro((e as Error).message ?? "Erro ao salvar.");
    }
  }

  const salvando = create.isPending || update.isPending;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editando ? "Editar evento" : "Novo evento"}</DialogTitle>
          <DialogDescription>
            Evento que o motorista registra durante a viagem. A ordem define a sequência guiada no
            app; &quot;obrigatório&quot; é um marco que bloqueia finalizar.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Slug</Label>
              <Input
                value={form.slug}
                onChange={(e) => setForm({ ...form, slug: e.target.value })}
                placeholder="ex: carga"
                disabled={editando}
                autoCapitalize="none"
              />
              <p className="text-xs text-muted-foreground">
                {editando
                  ? "O slug não pode ser alterado — é a chave estável do evento."
                  : "Chave estável, minúsculas e kebab-case. Não muda depois."}
              </p>
            </div>
            <div className="space-y-2">
              <Label>Ordem</Label>
              <Input
                inputMode="numeric"
                value={form.ordem}
                onChange={(e) => setForm({ ...form, ordem: e.target.value })}
                placeholder="0"
              />
              <p className="text-xs text-muted-foreground">Sequência guiada no app (menor primeiro).</p>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Nome</Label>
            <Input
              value={form.nome}
              onChange={(e) => setForm({ ...form, nome: e.target.value })}
              placeholder="ex: Carga"
            />
          </div>

          <div className="space-y-3">
            <p className="text-sm font-medium">Comportamento</p>
            <div className="space-y-3 rounded-md border p-3">
              {FLAGS_MARCO.map((f) => (
                <label key={f.key} className="flex items-start justify-between gap-3">
                  <span className="space-y-0.5">
                    <span className="block text-sm font-medium">{f.label}</span>
                    <span className="block text-xs text-muted-foreground">{f.hint}</span>
                  </span>
                  <StatusToggle
                    active={form[f.key]}
                    onChange={(next) => setFlag(f.key, next)}
                    size="sm"
                  />
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-sm font-medium">O que o evento pede ao motorista</p>
            <div className="grid gap-3 rounded-md border p-3 sm:grid-cols-2">
              {FLAGS_PEDE.map((f) => (
                <label key={f.key} className="flex items-center justify-between gap-3">
                  <span className="text-sm">{f.label}</span>
                  <StatusToggle
                    active={form[f.key]}
                    onChange={(next) => setFlag(f.key, next)}
                    size="sm"
                  />
                </label>
              ))}
            </div>
          </div>

          {editando && (
            <label className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium">Ativo</span>
              <StatusToggle
                active={form.ativo}
                onChange={(next) => setForm({ ...form, ativo: next })}
                size="sm"
                label
              />
            </label>
          )}

          {erro && <p className="text-sm text-destructive">{erro}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={salvando}>
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
