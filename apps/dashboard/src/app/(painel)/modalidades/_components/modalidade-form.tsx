"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusToggle } from "@/components/status-toggle";
import { Select } from "@/components/ui/select";
import {
  REMUNERACAO_LABEL,
  TIPOS_REMUNERACAO,
  type TipoRemuneracaoTipo,
} from "@ronan/shared-types";
import { useCreateResource, useUpdateResource } from "@/lib/client-api";
import { useSujo } from "@/hooks/use-sujo";
import { BotaoCancelar, useAvisarSeSujo } from "@/components/sair-sem-salvar";

export type Modalidade = {
  id: string;
  slug: string;
  nome: string;
  ativo: boolean;
  ordem: number;
  exigeFotoCupom: boolean;
  exigeFotoOdometro: boolean;
  exigeFotoBomba: boolean;
  tipoRemuneracao: TipoRemuneracaoTipo;
  percentualFrete: string | null;
  valorPorViagem: string | null;
  valorPorTonelada: string | null;
  valorPorKm: string | null;
  valorDiaria: string | null;
  reembolsaPedagio: boolean;
  reembolsaAbastecimento: boolean;
};

const PATH = "/admin/modalidades";

type Body = {
  nome: string;
  exigeFotoCupom: boolean;
  exigeFotoOdometro: boolean;
  exigeFotoBomba: boolean;
  ordem: number;
  tipoRemuneracao: TipoRemuneracaoTipo;
  percentualFrete: number | null;
  valorPorViagem: number | null;
  valorPorTonelada: number | null;
  valorPorKm: number | null;
  valorDiaria: number | null;
  reembolsaPedagio: boolean;
  reembolsaAbastecimento: boolean;
};

/** "12,5" → 12.5. Vazio ou inválido → null. */
function parseValor(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function ModalidadeForm({ initial }: { initial?: Modalidade }) {
  const router = useRouter();
  const create = useCreateResource<Body, Modalidade>(PATH, PATH);
  const update = useUpdateResource<Partial<Body>, Modalidade>(PATH, PATH);
  const [form, setForm] = useState({
    nome: initial?.nome ?? "",
    exigeFotoCupom: initial?.exigeFotoCupom ?? false,
    exigeFotoOdometro: initial?.exigeFotoOdometro ?? false,
    exigeFotoBomba: initial?.exigeFotoBomba ?? false,
    ordem: initial?.ordem ?? 0,
    tipoRemuneracao: (initial?.tipoRemuneracao ?? "SEM_REMUNERACAO") as TipoRemuneracaoTipo,
    percentualFrete: initial?.percentualFrete ?? "",
    valorPorViagem: initial?.valorPorViagem ?? "",
    valorPorTonelada: initial?.valorPorTonelada ?? "",
    valorPorKm: initial?.valorPorKm ?? "",
    valorDiaria: initial?.valorDiaria ?? "",
    reembolsaPedagio: initial?.reembolsaPedagio ?? true,
    reembolsaAbastecimento: initial?.reembolsaAbastecimento ?? true,
  });

  // Sair de um cadastro longo descartava tudo em silêncio.
  const sujo = useSujo(form);
  useAvisarSeSujo(sujo);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const body: Body = {
      nome: form.nome,
      exigeFotoCupom: form.exigeFotoCupom,
      exigeFotoOdometro: form.exigeFotoOdometro,
      exigeFotoBomba: form.exigeFotoBomba,
      ordem: form.ordem,
      tipoRemuneracao: form.tipoRemuneracao,
      // Só o campo da régua escolhida é enviado. Mandar os outros deixaria
      // valores órfãos no banco que reapareceriam ao trocar de régua.
      percentualFrete: form.tipoRemuneracao === "PERCENTUAL_FRETE" ? parseValor(form.percentualFrete) : null,
      valorPorViagem: form.tipoRemuneracao === "VALOR_POR_VIAGEM" ? parseValor(form.valorPorViagem) : null,
      valorPorTonelada: form.tipoRemuneracao === "VALOR_POR_TONELADA" ? parseValor(form.valorPorTonelada) : null,
      valorPorKm: form.tipoRemuneracao === "VALOR_POR_KM" ? parseValor(form.valorPorKm) : null,
      // A diária é independente da régua: vale sempre.
      valorDiaria: parseValor(form.valorDiaria),
      reembolsaPedagio: form.reembolsaPedagio,
      reembolsaAbastecimento: form.reembolsaAbastecimento,
    };
    if (initial) await update.mutateAsync({ id: initial.id, body });
    else await create.mutateAsync(body);
    router.push("/modalidades");
  }

  const campoDaRegua = REMUNERACAO_LABEL[form.tipoRemuneracao].campo;

  const saving = create.isPending || update.isPending;

  return (
    <Card className="p-6">
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="nome">Nome</Label>
          <Input
            id="nome"
            required
            value={form.nome}
            onChange={(e) => setForm({ ...form, nome: e.target.value })}
            placeholder="ex: Agregado"
            autoFocus
          />
          <p className="text-xs text-muted-foreground">
            É como o vínculo aparece no cadastro do motorista. O motorista não vê nem
            escolhe a modalidade dele.
          </p>
        </div>

        <div className="space-y-3 rounded-lg border p-3">
          <div>
            <Label className="text-base">Fotos no abastecimento</Label>
            <p className="text-xs text-muted-foreground">
              O que o app exige de quem está nesta modalidade. Deixe tudo desligado pra
              não pedir nada — é assim que “frota própria” não tira foto nenhuma.
            </p>
          </div>
          <LinhaFlag
            titulo="Cupom do posto"
            hint="Para quem tem modalidade, este interruptor SUBSTITUI o de Minha empresa — é ele que vale."
            active={form.exigeFotoCupom}
            onChange={(v) => setForm({ ...form, exigeFotoCupom: v })}
          />
          <LinhaFlag
            titulo="Odômetro (KM)"
            hint="Comprova o quilômetro do caminhão no momento do abastecimento."
            active={form.exigeFotoOdometro}
            onChange={(v) => setForm({ ...form, exigeFotoOdometro: v })}
          />
          <LinhaFlag
            titulo="Bomba"
            hint="Foto da bomba do posto."
            active={form.exigeFotoBomba}
            onChange={(v) => setForm({ ...form, exigeFotoBomba: v })}
          />
        </div>

        <div className="space-y-3 rounded-lg border p-3">
          <div>
            <Label className="text-base">Como o motorista é pago</Label>
            <p className="text-xs text-muted-foreground">
              É o que entra no acerto do fim do mês. Um motorista pode ter regra própria
              no cadastro dele, e ela vence esta.
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="modalidade-regra-de-pagamento">Regra de pagamento</Label>
              <Select id="modalidade-regra-de-pagamento"
                value={form.tipoRemuneracao}
                onChange={(e) =>
                  setForm({ ...form, tipoRemuneracao: e.target.value as TipoRemuneracaoTipo })
                }
              >
                {TIPOS_REMUNERACAO.map((t) => (
                  <option key={t} value={t}>
                    {REMUNERACAO_LABEL[t].nome}
                  </option>
                ))}
              </Select>
            </div>

            {campoDaRegua === "percentualFrete" && (
              <div className="space-y-2">
                <Label htmlFor="modalidade-porcentagem-do-frete">Porcentagem do frete (%)</Label>
                <Input id="modalidade-porcentagem-do-frete"
                  inputMode="decimal"
                  placeholder="ex: 12"
                  value={form.percentualFrete}
                  onChange={(e) => setForm({ ...form, percentualFrete: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  Precisa de preço cadastrado pra empresa — sem valor na viagem não há de
                  que tirar porcentagem.
                </p>
              </div>
            )}
            {campoDaRegua === "valorPorViagem" && (
              <div className="space-y-2">
                <Label htmlFor="modalidade-valor-por-viagem-r">Valor por viagem (R$)</Label>
                <Input id="modalidade-valor-por-viagem-r"
                  inputMode="decimal"
                  placeholder="ex: 120,00"
                  value={form.valorPorViagem}
                  onChange={(e) => setForm({ ...form, valorPorViagem: e.target.value })}
                />
              </div>
            )}
            {campoDaRegua === "valorPorTonelada" && (
              <div className="space-y-2">
                <Label htmlFor="modalidade-valor-por-tonelada-r">Valor por tonelada (R$)</Label>
                <Input id="modalidade-valor-por-tonelada-r"
                  inputMode="decimal"
                  placeholder="ex: 8,50"
                  value={form.valorPorTonelada}
                  onChange={(e) => setForm({ ...form, valorPorTonelada: e.target.value })}
                />
              </div>
            )}
            {campoDaRegua === "valorPorKm" && (
              <div className="space-y-2">
                <Label htmlFor="modalidade-valor-por-km-r">Valor por km (R$)</Label>
                <Input id="modalidade-valor-por-km-r"
                  inputMode="decimal"
                  placeholder="ex: 3,50"
                  value={form.valorPorKm}
                  onChange={(e) => setForm({ ...form, valorPorKm: e.target.value })}
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="modalidade-valor-da-diaria-r">Valor da diária (R$)</Label>
              <Input id="modalidade-valor-da-diaria-r"
                inputMode="decimal"
                placeholder="deixe vazio se não faz diária"
                value={form.valorDiaria}
                onChange={(e) => setForm({ ...form, valorDiaria: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                Vale sempre, independente da regra acima — um motorista pago por
                porcentagem também pode ficar um dia à disposição.
              </p>
            </div>
          </div>

          <div className="space-y-3 border-t pt-3">
            <LinhaFlag
              titulo="Devolve o pedágio que ele pagou"
              hint="O pedágio que ele adiantou do próprio bolso entra como crédito no acerto."
              active={form.reembolsaPedagio}
              onChange={(v) => setForm({ ...form, reembolsaPedagio: v })}
            />
            <LinhaFlag
              titulo="Devolve o abastecimento que ele pagou"
              hint="Diesel de comboio nunca entra — esse é da empresa, ele não pagou nada."
              active={form.reembolsaAbastecimento}
              onChange={(v) => setForm({ ...form, reembolsaAbastecimento: v })}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <BotaoCancelar href="/modalidades" sujo={sujo} />
          <Button type="submit" disabled={saving}>
            Salvar
          </Button>
        </div>
      </form>
    </Card>
  );
}

function LinhaFlag({
  titulo,
  hint,
  active,
  onChange,
}: {
  titulo: string;
  hint: string;
  active: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">{titulo}</span>
        <StatusToggle active={active} onChange={onChange} size="sm" />
      </div>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}
