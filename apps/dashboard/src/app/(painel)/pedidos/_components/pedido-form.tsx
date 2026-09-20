"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { UNIDADES_PEDIDO, UNIDADE_PEDIDO_LABEL, type UnidadePedidoTipo } from "@ronan/shared-types";
import { ClienteCombobox, clienteOption, LocalCombobox } from "@/components/fk-comboboxes";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useCreateResource, useResourceOptions, useUpdateResource } from "@/lib/client-api";
import { useSujo } from "@/hooks/use-sujo";
import { BotaoCancelar, useAvisarSeSujo } from "@/components/sair-sem-salvar";
import { hojeSP } from "@/lib/datetime-br";

type Nomeado = { id: string; nome: string };

export type Pedido = {
  id: string;
  numero: number;
  empresaId: string;
  empresa: Nomeado;
  clienteId: string | null;
  cliente: Nomeado | null;
  materialId: string | null;
  localCargaId: string | null;
  localCarga: (Nomeado & { cidade: string | null; uf: string | null }) | null;
  localDescargaId: string | null;
  localDescarga: (Nomeado & { cidade: string | null; uf: string | null }) | null;
  tipoServicoId: string | null;
  quantidadeAlvo: string;
  unidadeAlvo: UnidadePedidoTipo;
  inicioEm: string;
  prazoEm: string | null;
  prioridade: number;
  status: string;
  observacao: string | null;
};

const PATH = "/admin/pedidos";

type Body = {
  empresaId: string;
  clienteId: string | null;
  materialId: string | null;
  localCargaId: string | null;
  localDescargaId: string | null;
  tipoServicoId: string | null;
  quantidadeAlvo: number;
  unidadeAlvo: UnidadePedidoTipo;
  inicioEm: string;
  prazoEm: string | null;
  prioridade: number;
  observacao: string | null;
};

function soData(v: string | null | undefined): string {
  return v ? v.slice(0, 10) : "";
}

function localOption(l: (Nomeado & { cidade: string | null; uf: string | null }) | null) {
  if (!l) return undefined;
  return {
    value: l.id,
    label: l.cidade ? `${l.nome} — ${l.cidade}${l.uf ? `/${l.uf}` : ""}` : l.nome,
  };
}

export function PedidoForm({ initial }: { initial?: Pedido }) {
  const router = useRouter();
  const empresas = useResourceOptions<Nomeado>("/admin/empresas");
  const materiais = useResourceOptions<Nomeado>("/admin/materiais");
  const tiposServico = useResourceOptions<Nomeado>("/admin/tipos-servico");
  const create = useCreateResource<Body, Pedido>(PATH, PATH);
  const update = useUpdateResource<Partial<Body>, Pedido>(PATH, PATH);
  const [erro, setErro] = useState<string | null>(null);

  const hoje = hojeSP();
  const [form, setForm] = useState({
    empresaId: initial?.empresaId ?? "",
    clienteId: initial?.clienteId ?? undefined,
    materialId: initial?.materialId ?? "",
    localCargaId: initial?.localCargaId ?? undefined,
    localDescargaId: initial?.localDescargaId ?? undefined,
    tipoServicoId: initial?.tipoServicoId ?? "",
    quantidadeAlvo: initial?.quantidadeAlvo ?? "",
    unidadeAlvo: (initial?.unidadeAlvo ?? "VIAGENS") as UnidadePedidoTipo,
    inicioEm: soData(initial?.inicioEm) || hoje,
    prazoEm: soData(initial?.prazoEm),
    prioridade: initial?.prioridade ?? 0,
    observacao: initial?.observacao ?? "",
  });

  // Sair de um cadastro longo descartava tudo em silêncio.
  const sujo = useSujo(form);
  useAvisarSeSujo(sujo);

  useEffect(() => {
    if (initial || form.empresaId || !empresas.data?.[0]?.id) return;
    setForm((f) => ({ ...f, empresaId: empresas.data![0]!.id }));
  }, [initial, form.empresaId, empresas.data]);

  async function onSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    setErro(null);

    const qtd = Number(form.quantidadeAlvo.replace(/\./g, "").replace(",", "."));
    if (!form.empresaId) return setErro("Escolha a empresa.");
    if (!Number.isFinite(qtd) || qtd <= 0) return setErro("Informe quanto foi pedido.");
    if (form.prazoEm && form.prazoEm < form.inicioEm) {
      return setErro("O prazo não pode ser antes do início.");
    }

    const body: Body = {
      empresaId: form.empresaId,
      clienteId: form.clienteId ?? null,
      materialId: form.materialId || null,
      localCargaId: form.localCargaId ?? null,
      localDescargaId: form.localDescargaId ?? null,
      tipoServicoId: form.tipoServicoId || null,
      quantidadeAlvo: qtd,
      unidadeAlvo: form.unidadeAlvo,
      inicioEm: form.inicioEm,
      prazoEm: form.prazoEm || null,
      prioridade: form.prioridade,
      observacao: form.observacao.trim() || null,
    };

    try {
      if (initial) await update.mutateAsync({ id: initial.id, body });
      else await create.mutateAsync(body);
      router.push("/pedidos");
    } catch (e) {
      setErro((e as Error).message || "Não salvei. Confira os campos e tente de novo.");
    }
  }

  const saving = create.isPending || update.isPending;

  return (
    <Card className="p-6">
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="pedidoform-empresa-que-pediu">Empresa que pediu</Label>
            <Select id="pedidoform-empresa-que-pediu"
              required
              value={form.empresaId}
              onChange={(e) => setForm({ ...form, empresaId: e.target.value, clienteId: undefined })}
            >
              <option value="" disabled>
                Escolha a empresa
              </option>
              {empresas.data?.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nome}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Obra / frente</Label>
            <ClienteCombobox
              value={form.clienteId}
              onChange={(v) => setForm({ ...form, clienteId: v })}
              triggerClassName="sm:w-full"
              initialOption={initial?.cliente ? clienteOption(initial.cliente) : undefined}
            />
            <p className="text-xs text-muted-foreground">
              Deixe vazio se o pedido vale pra qualquer obra dessa empresa.
            </p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="pedidoform-quanto">Quanto</Label>
            <Input id="pedidoform-quanto"
              inputMode="decimal"
              placeholder="ex: 20"
              value={form.quantidadeAlvo}
              onChange={(e) => setForm({ ...form, quantidadeAlvo: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pedidoform-medido-em">Medido em</Label>
            <Select id="pedidoform-medido-em"
              value={form.unidadeAlvo}
              onChange={(e) =>
                setForm({ ...form, unidadeAlvo: e.target.value as UnidadePedidoTipo })
              }
            >
              {UNIDADES_PEDIDO.map((u) => (
                <option key={u} value={u}>
                  {UNIDADE_PEDIDO_LABEL[u]}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="pedidoform-material">Material</Label>
            <Select id="pedidoform-material"
              value={form.materialId}
              onChange={(e) => setForm({ ...form, materialId: e.target.value })}
            >
              <option value="">Qualquer material</option>
              {materiais.data?.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nome}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Carrega em</Label>
            <LocalCombobox
              value={form.localCargaId}
              onChange={(v) => setForm({ ...form, localCargaId: v })}
              triggerClassName="sm:w-full"
              initialOption={localOption(initial?.localCarga ?? null)}
            />
          </div>
          <div className="space-y-2">
            <Label>Entrega em</Label>
            <LocalCombobox
              value={form.localDescargaId}
              onChange={(v) => setForm({ ...form, localDescargaId: v })}
              triggerClassName="sm:w-full"
              initialOption={localOption(initial?.localDescarga ?? null)}
            />
            <p className="text-xs text-muted-foreground">
              É o campo que mais ajuda o sistema a saber quais viagens abatem este pedido.
            </p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="pedido-inicio">Começa em</Label>
            <Input
              id="pedido-inicio"
              type="date"
              value={form.inicioEm}
              onChange={(e) => setForm({ ...form, inicioEm: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pedido-prazo">Prazo</Label>
            <Input
              id="pedido-prazo"
              type="date"
              value={form.prazoEm}
              onChange={(e) => setForm({ ...form, prazoEm: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              Vazio = sem prazo combinado. Com prazo, a tela calcula o ritmo por dia.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="pedidoform-prioridade">Prioridade</Label>
            <Select id="pedidoform-prioridade"
              value={String(form.prioridade)}
              onChange={(e) => setForm({ ...form, prioridade: Number(e.target.value) })}
            >
              <option value="0">Normal</option>
              <option value="5">Alta</option>
              <option value="9">Urgente</option>
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="pedido-obs">Observação</Label>
          <Input
            id="pedido-obs"
            placeholder="o que mais importa saber sobre esse pedido"
            value={form.observacao}
            onChange={(e) => setForm({ ...form, observacao: e.target.value })}
          />
        </div>

        {erro && <p className="text-sm text-destructive">{erro}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <BotaoCancelar href="/pedidos" sujo={sujo} />
          <Button type="submit" disabled={saving}>
            Salvar
          </Button>
        </div>
      </form>
    </Card>
  );
}
