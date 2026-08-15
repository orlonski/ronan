"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusToggle } from "@/components/status-toggle";
import { Select } from "@/components/ui/select";
import { useCreateResource, useUpdateResource } from "@/lib/client-api";
import { documentoDigits, maskDocumento } from "@ronan/shared-types";

type Papel = "RECEBE_PLANILHA" | "MANDA_FECHAMENTO" | "AMBOS";
export type Empresa = {
  id: string;
  nome: string;
  cnpj: string | null;
  contato: string | null;
  papel: Papel;
  ativa: boolean;
  /** Exige a FOTO do comprovante no lançamento (não confundir com o número do ticket). */
  exigeFotoViagem: boolean;
  exigeFotoAbastecimento: boolean;
};

const PATH = "/admin/empresas";

type Props = { initial?: Empresa };

export function EmpresaForm({ initial }: Props) {
  const router = useRouter();
  const create = useCreateResource<Partial<Empresa>, Empresa>(PATH, PATH);
  const update = useUpdateResource<Partial<Empresa>, Empresa>(PATH, PATH);

  const [form, setForm] = useState({
    nome: initial?.nome ?? "",
    cnpj: maskDocumento(initial?.cnpj ?? ""),
    contato: initial?.contato ?? "",
    papel: (initial?.papel ?? "AMBOS") as Papel,
    exigeFotoViagem: initial?.exigeFotoViagem ?? false,
    exigeFotoAbastecimento: initial?.exigeFotoAbastecimento ?? false,
  });

  // Vazio é permitido (campo opcional); preenchido tem que fechar 11 ou 14 dígitos.
  const digitos = documentoDigits(form.cnpj);
  const documentoIncompleto =
    digitos.length > 0 && digitos.length !== 11 && digitos.length !== 14;

  async function onSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    if (documentoIncompleto) return;
    const body: Partial<Empresa> = {
      nome: form.nome,
      cnpj: digitos || undefined,
      contato: form.contato || undefined,
      papel: form.papel,
      exigeFotoViagem: form.exigeFotoViagem,
      exigeFotoAbastecimento: form.exigeFotoAbastecimento,
    };
    if (initial) {
      await update.mutateAsync({ id: initial.id, body });
    } else {
      await create.mutateAsync(body);
    }
    router.push("/empresas");
  }

  const saving = create.isPending || update.isPending;

  return (
    <Card className="p-6">
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label>Nome</Label>
          <Input
            required
            autoFocus
            value={form.nome}
            onChange={(e) => setForm({ ...form, nome: e.target.value })}
          />
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <Label>CNPJ ou CPF</Label>
            <Input
              value={form.cnpj}
              inputMode="numeric"
              maxLength={18}
              onChange={(e) => setForm({ ...form, cnpj: maskDocumento(e.target.value) })}
              placeholder="12.345.678/0001-99 ou 123.456.789-01"
              aria-invalid={documentoIncompleto || undefined}
            />
            {documentoIncompleto && (
              <p className="text-xs text-destructive">
                Faltam dígitos: CPF tem 11 e CNPJ tem 14.
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label>Papel</Label>
            <Select
              value={form.papel}
              onChange={(e) => setForm({ ...form, papel: e.target.value as Papel })}
            >
              <option value="AMBOS">Ambos</option>
              <option value="RECEBE_PLANILHA">Recebe planilha</option>
              <option value="MANDA_FECHAMENTO">Manda fechamento</option>
            </Select>
          </div>
        </div>
        <div className="space-y-2">
          <Label>Contato</Label>
          <Input
            value={form.contato}
            onChange={(e) => setForm({ ...form, contato: e.target.value })}
          />
        </div>
        <div className="space-y-3 rounded-lg border p-3">
          <div>
            <Label className="text-base">Comprovantes</Label>
            <p className="text-xs text-muted-foreground">
              Quando ligado, o app não deixa o motorista salvar sem a foto. Se ele
              não conseguir fotografar, precisa escrever o motivo — e o lançamento
              aparece aqui marcado como “sem foto”, pra você cobrar.
            </p>
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium">Foto do ticket na viagem</span>
              <StatusToggle
                active={form.exigeFotoViagem}
                onChange={(next) => setForm({ ...form, exigeFotoViagem: next })}
                size="sm"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Material marcado como “não gera comprovante” (ex.: concreto) e diária
              ficam de fora sozinhos — não dá pra cobrar foto de papel que não existe.
            </p>
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium">Foto do cupom no abastecimento</span>
              <StatusToggle
                active={form.exigeFotoAbastecimento}
                onChange={(next) => setForm({ ...form, exigeFotoAbastecimento: next })}
                size="sm"
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Link href="/empresas">
            <Button type="button" variant="outline">
              Cancelar
            </Button>
          </Link>
          <Button type="submit" disabled={saving || documentoIncompleto}>
            Salvar
          </Button>
        </div>
      </form>
    </Card>
  );
}
