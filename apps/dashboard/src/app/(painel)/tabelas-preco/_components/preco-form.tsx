"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BASE_PRECO_AJUDA,
  BASE_PRECO_LABEL,
  BASES_PRECO,
  type BasePrecoTipo,
} from "@ronan/shared-types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useCreateResource, useResourceOptions, useUpdateResource } from "@/lib/client-api";
import { useSujo } from "@/hooks/use-sujo";
import { BotaoCancelar, useAvisarSeSujo } from "@/components/sair-sem-salvar";
import { hojeSP } from "@/lib/datetime-br";

type Empresa = { id: string; nome: string };
type Material = { id: string; nome: string };
type TipoServico = { id: string; nome: string };

export type Preco = {
  id: string;
  empresaId: string;
  empresa: Empresa;
  materialId: string | null;
  material: Material | null;
  tipoServicoId: string | null;
  tipoServico: TipoServico | null;
  kmFaixaDe: string;
  kmFaixaAte: string | null;
  base: BasePrecoTipo;
  precoUnitario: string;
  repassaPedagio: boolean;
  vigenciaDe: string;
  vigenciaAte: string | null;
  ativo: boolean;
};

const PATH = "/admin/tabelas-preco";

type PrecoBody = {
  empresaId: string;
  materialId: string | null;
  tipoServicoId: string | null;
  kmFaixaDe: number;
  kmFaixaAte: number | null;
  base: BasePrecoTipo;
  precoUnitario: number;
  repassaPedagio: boolean;
  vigenciaDe: string;
  vigenciaAte: string | null;
};

/** "12,5" / "12.5" → 12.5. Vazio → null. Só positivos. */
function parseDecimalBR(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** ISO do backend ("2026-06-01T00:00:00.000Z") → "2026-06-01" pro input date. */
function soData(v: string | null | undefined): string {
  return v ? v.slice(0, 10) : "";
}

export function PrecoForm({ initial }: { initial?: Preco }) {
  const router = useRouter();
  const empresas = useResourceOptions<Empresa>("/admin/empresas");
  const materiais = useResourceOptions<Material>("/admin/materiais");
  const tiposServico = useResourceOptions<TipoServico>("/admin/tipos-servico");
  const create = useCreateResource<PrecoBody, Preco>(PATH, PATH);
  const update = useUpdateResource<Partial<PrecoBody>, Preco>(PATH, PATH);
  const [erro, setErro] = useState<string | null>(null);

  const [form, setForm] = useState({
    empresaId: initial?.empresaId ?? "",
    materialId: initial?.materialId ?? "",
    tipoServicoId: initial?.tipoServicoId ?? "",
    kmFaixaDe: initial?.kmFaixaDe ?? "0",
    kmFaixaAte: initial?.kmFaixaAte ?? "",
    base: (initial?.base ?? "TONELADA") as BasePrecoTipo,
    precoUnitario: initial?.precoUnitario ?? "",
    repassaPedagio: initial?.repassaPedagio ?? false,
    // Preço novo passa a valer hoje, que é o que quase sempre se quer.
    vigenciaDe: soData(initial?.vigenciaDe) || hojeSP(),
    vigenciaAte: soData(initial?.vigenciaAte),
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

    const kmDe = form.kmFaixaDe.trim() ? Number(form.kmFaixaDe.replace(",", ".")) : 0;
    const kmAte = parseDecimalBR(form.kmFaixaAte);
    const preco = parseDecimalBR(form.precoUnitario);

    if (!form.empresaId) return setErro("Escolha a empresa.");
    if (preco == null) return setErro("Informe o preço.");
    if (!Number.isFinite(kmDe) || kmDe < 0) return setErro("Faixa 'de' inválida.");
    if (kmAte != null && kmAte <= kmDe) return setErro("A faixa 'até' precisa ser maior que o 'de'.");
    if (!form.vigenciaDe) return setErro("Informe a partir de quando este preço vale.");
    if (form.vigenciaAte && form.vigenciaAte < form.vigenciaDe) {
      return setErro("O fim da vigência não pode ser antes do início.");
    }

    const body: PrecoBody = {
      empresaId: form.empresaId,
      materialId: form.materialId || null,
      tipoServicoId: form.tipoServicoId || null,
      kmFaixaDe: kmDe,
      kmFaixaAte: kmAte,
      base: form.base,
      precoUnitario: preco,
      repassaPedagio: form.repassaPedagio,
      vigenciaDe: form.vigenciaDe,
      vigenciaAte: form.vigenciaAte || null,
    };

    try {
      if (initial) await update.mutateAsync({ id: initial.id, body });
      else await create.mutateAsync(body);
      router.push("/tabelas-preco");
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
            <Label htmlFor="precoform-empresa-que-paga">Empresa que paga</Label>
            <Select id="precoform-empresa-que-paga"
              required
              value={form.empresaId}
              onChange={(e) => setForm({ ...form, empresaId: e.target.value })}
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
            <Label htmlFor="precoform-material">Material</Label>
            <Select id="precoform-material"
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
            <Label htmlFor="precoform-modo-de-servico">Modo de serviço</Label>
            <Select id="precoform-modo-de-servico"
              value={form.tipoServicoId}
              onChange={(e) => setForm({ ...form, tipoServicoId: e.target.value })}
            >
              <option value="">Qualquer modo</option>
              {tiposServico.data?.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nome}
                </option>
              ))}
            </Select>
            <p className="text-xs text-muted-foreground">
              Escolha só se o modo tiver preço próprio.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="precoform-cobrado-por">Cobrado por</Label>
            <Select id="precoform-cobrado-por"
              value={form.base}
              onChange={(e) => setForm({ ...form, base: e.target.value as BasePrecoTipo })}
            >
              {BASES_PRECO.map((b) => (
                <option key={b} value={b}>
                  {BASE_PRECO_LABEL[b].nome}
                </option>
              ))}
            </Select>
            <p className="text-xs text-muted-foreground">{BASE_PRECO_AJUDA[form.base]}</p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Preço ({BASE_PRECO_LABEL[form.base].unidade})</Label>
            <Input
              inputMode="decimal"
              placeholder="ex: 12,50"
              value={form.precoUnitario}
              onChange={(e) => setForm({ ...form, precoUnitario: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>Pedágio</Label>
            <label className="flex h-10 items-center gap-2 text-sm">
              <input
                type="checkbox"
                id="repassa-pedagio"
                checked={form.repassaPedagio}
                onChange={(e) => setForm({ ...form, repassaPedagio: e.target.checked })}
                className="h-4 w-4"
              />
              A empresa devolve o pedágio por fora do frete
            </label>
          </div>
        </div>

        <div className="space-y-1">
          <Label>Faixa de km rodado</Label>
          <div className="flex items-center gap-2">
            <Input
              inputMode="decimal"
              placeholder="de (ex: 0)"
              value={form.kmFaixaDe}
              onChange={(e) => setForm({ ...form, kmFaixaDe: e.target.value })}
              className="w-32"
            />
            <span className="text-sm text-muted-foreground">até</span>
            <Input
              inputMode="decimal"
              placeholder="sem teto"
              value={form.kmFaixaAte}
              onChange={(e) => setForm({ ...form, kmFaixaAte: e.target.value })}
              className="w-32"
            />
            <span className="text-sm text-muted-foreground">km</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Mesma regra dos mínimos: &quot;de&quot; incluído, &quot;até&quot; excluído. Deixe o
            &quot;até&quot; vazio pra valer em qualquer distância.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="vigencia-de">Vale a partir de</Label>
            <Input
              type="date"
              id="vigencia-de"
              value={form.vigenciaDe}
              onChange={(e) => setForm({ ...form, vigenciaDe: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="vigencia-ate">Vale até</Label>
            <Input
              type="date"
              id="vigencia-ate"
              value={form.vigenciaAte}
              onChange={(e) => setForm({ ...form, vigenciaAte: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              Vazio = até segunda ordem. Ao reajustar, feche a vigência do preço antigo no dia
              anterior — assim as viagens de cada mês continuam valendo o preço daquele mês.
            </p>
          </div>
        </div>

        {erro && <p className="text-sm text-destructive">{erro}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <BotaoCancelar href="/tabelas-preco" sujo={sujo} />
          <Button type="submit" disabled={saving}>
            Salvar
          </Button>
        </div>
      </form>
    </Card>
  );
}
