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
import { Select } from "@/components/ui/select";
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
  // --- ocorrência ---
  ehOcorrencia: boolean;
  severidade: "BAIXA" | "MEDIA" | "ALTA";
  temDuracao: boolean;
  geraCobranca: boolean;
  valorHora: string;
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
    ehOcorrencia: initial?.ehOcorrencia ?? false,
    severidade: initial?.severidade ?? "MEDIA",
    temDuracao: initial?.temDuracao ?? false,
    geraCobranca: initial?.geraCobranca ?? false,
    valorHora: initial?.valorHora ?? "",
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

    // Vazio é resposta legítima: "ainda não combinamos o preço da hora". O
    // sistema conta as horas de qualquer jeito e não inventa valor.
    const bruto = form.valorHora.trim().replace(/\./g, "").replace(",", ".");
    let valorHora: number | null = null;
    if (form.ehOcorrencia && form.temDuracao && form.geraCobranca && bruto !== "") {
      valorHora = Number(bruto);
      if (!Number.isFinite(valorHora) || valorHora < 0) {
        return setErro("Valor da hora inválido.");
      }
    }

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
      ehOcorrencia: form.ehOcorrencia,
      // Severidade e duração só fazem sentido em ocorrência; mandar mesmo
      // desmarcado deixaria "ALTA" grudado num evento da espinha se alguém
      // desmarcasse depois de marcar.
      severidade: form.ehOcorrencia ? form.severidade : null,
      temDuracao: form.ehOcorrencia && form.temDuracao,
      geraCobranca: form.ehOcorrencia && form.temDuracao && form.geraCobranca,
      valorHora: valorHora,
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
      setErro((e as Error).message || "Não salvei. Confira os campos e tente de novo.");
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

          {/* Ocorrência: a espinha acima só sabe contar o dia que correu bem.
              É aqui que "fiquei 3h na fila" e "quebrei na BR" ganham lugar — e
              onde o preço da hora parada é combinado. */}
          <div className="space-y-3">
            <label className="flex items-start justify-between gap-3">
              <span className="space-y-0.5">
                <span className="block text-sm font-medium">É uma ocorrência</span>
                <span className="block text-xs text-muted-foreground">
                  Algo que deu errado (fila, quebra, carga recusada). Aparece na torre e
                  fica fora da sequência guiada do app.
                </span>
              </span>
              <StatusToggle
                active={form.ehOcorrencia}
                onChange={(next) => setForm({ ...form, ehOcorrencia: next })}
                size="sm"
              />
            </label>

            {form.ehOcorrencia && (
              <div className="space-y-3 rounded-md border p-3">
                <div className="space-y-2">
                  <Label>Gravidade</Label>
                  <Select
                    value={form.severidade}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        severidade: e.target.value as FormState["severidade"],
                      })
                    }
                  >
                    <option value="ALTA">Alta — vira aviso na hora</option>
                    <option value="MEDIA">Média</option>
                    <option value="BAIXA">Baixa</option>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Ordena a fila da torre. Só a alta manda notificação — notificar tudo é
                    como se ensina alguém a ignorar notificação.
                  </p>
                </div>

                <label className="flex items-start justify-between gap-3">
                  <span className="space-y-0.5">
                    <span className="block text-sm font-medium">Tem início e fim</span>
                    <span className="block text-xs text-muted-foreground">
                      Fila e espera duram; carga recusada acontece e pronto.
                    </span>
                  </span>
                  <StatusToggle
                    active={form.temDuracao}
                    onChange={(next) => setForm({ ...form, temDuracao: next })}
                    size="sm"
                  />
                </label>

                {form.temDuracao && (
                  <label className="flex items-start justify-between gap-3">
                    <span className="space-y-0.5">
                      <span className="block text-sm font-medium">
                        O tempo parado é faturável
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        Estadia: cobrada por hora cheia iniciada.
                      </span>
                    </span>
                    <StatusToggle
                      active={form.geraCobranca}
                      onChange={(next) => setForm({ ...form, geraCobranca: next })}
                      size="sm"
                    />
                  </label>
                )}

                {form.temDuracao && form.geraCobranca && (
                  <div className="space-y-2">
                    <Label>Valor da hora parada</Label>
                    <Input
                      inputMode="decimal"
                      value={form.valorHora}
                      onChange={(e) => setForm({ ...form, valorHora: e.target.value })}
                      placeholder="ex: 80,00"
                    />
                    <p className="text-xs text-muted-foreground">
                      Pode ficar em branco: as horas continuam sendo contadas e o sistema
                      não inventa preço. O que vale é o que está no contrato.
                    </p>
                  </div>
                )}
              </div>
            )}
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
