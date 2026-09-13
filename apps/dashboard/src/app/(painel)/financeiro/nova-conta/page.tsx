"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TIPO_FORNECEDOR_LABEL } from "@ronan/shared-types";
import { RequerTela } from "@/components/requer-tela";
import { FormPageHeader } from "@/components/form-page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { MotoristaCombobox, VeiculoCombobox } from "@/components/fk-comboboxes";
import { fetchApi, useAuthToken, useResourceOptions } from "@/lib/client-api";

type Fornecedor = { id: string; nome: string; tipo: keyof typeof TIPO_FORNECEDOR_LABEL };

/**
 * Conta a pagar lançada à mão: oficina, posto, seguro, parcela do caminhão.
 *
 * O acerto do motorista já gera título sozinho — este formulário é pro que não
 * nasce de um acerto.
 */
export default function NovaContaPage() {
  return (
    <RequerTela chave="financeiro.faturar">
      <Conteudo />
    </RequerTela>
  );
}

function Conteudo() {
  const router = useRouter();
  const token = useAuthToken();
  const fornecedores = useResourceOptions<Fornecedor>("/admin/fornecedores");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const hoje = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    descricao: "",
    valor: "",
    vencimento: hoje,
    fornecedorId: "",
    motoristaId: undefined as string | undefined,
    veiculoId: undefined as string | undefined,
    observacao: "",
  });

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    const valor = Number(form.valor.replace(/\./g, "").replace(",", "."));
    if (form.descricao.trim().length < 3) return setErro("Diga o que é essa conta.");
    if (!Number.isFinite(valor) || valor <= 0) return setErro("Informe o valor.");

    setErro(null);
    setSalvando(true);
    try {
      await fetchApi("/admin/financeiro/pagar", {
        token,
        method: "POST",
        body: JSON.stringify({
          descricao: form.descricao,
          valor,
          vencimento: form.vencimento,
          fornecedorId: form.fornecedorId || null,
          motoristaId: form.motoristaId ?? null,
          veiculoId: form.veiculoId ?? null,
          observacao: form.observacao.trim() || null,
        }),
      });
      router.push("/financeiro");
    } catch (e2) {
      setErro((e2 as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="space-y-6">
      <FormPageHeader
        title="Lançar conta a pagar"
        description="Oficina, posto, seguro, parcela. O acerto do motorista gera título sozinho."
        backHref="/financeiro"
      />
      <Card className="p-6">
        <form onSubmit={salvar} className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="conta-descricao">O que é</Label>
              <Input
                id="conta-descricao"
                placeholder="ex: Troca de pneus dianteiros"
                value={form.descricao}
                onChange={(e) => setForm({ ...form, descricao: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="conta-valor">Valor (R$)</Label>
              <Input
                id="conta-valor"
                inputMode="decimal"
                placeholder="ex: 2.400,00"
                value={form.valor}
                onChange={(e) => setForm({ ...form, valor: e.target.value })}
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="conta-venc">Vence em</Label>
              <Input
                id="conta-venc"
                type="date"
                value={form.vencimento}
                onChange={(e) => setForm({ ...form, vencimento: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="conta-forn">Para quem</Label>
              <Select
                id="conta-forn"
                value={form.fornecedorId}
                onChange={(e) => setForm({ ...form, fornecedorId: e.target.value })}
              >
                <option value="">Sem fornecedor cadastrado</option>
                {fornecedores.data?.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.nome} · {TIPO_FORNECEDOR_LABEL[f.tipo]}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Motorista (se for pra ele)</Label>
              <MotoristaCombobox
                value={form.motoristaId}
                onChange={(v) => setForm({ ...form, motoristaId: v })}
              />
            </div>
            <div className="space-y-2">
              <Label>Caminhão</Label>
              <VeiculoCombobox
                value={form.veiculoId}
                onChange={(v) => setForm({ ...form, veiculoId: v })}
                triggerClassName="sm:w-full"
              />
              <p className="text-xs text-muted-foreground">
                Amarrando ao caminhão, o custo entra no cálculo por veículo.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="conta-obs">Observação</Label>
            <Input
              id="conta-obs"
              value={form.observacao}
              onChange={(e) => setForm({ ...form, observacao: e.target.value })}
            />
          </div>

          {erro && <p className="text-sm text-destructive">{erro}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Link href="/financeiro">
              <Button type="button" variant="outline">
                Cancelar
              </Button>
            </Link>
            <Button type="submit" disabled={salvando}>
              Lançar
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
