"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCreateResource, useUpdateResource } from "@/lib/client-api";
import { documentoDigits, maskDocumento } from "@ronan/shared-types";

export type Transportadora = {
  id: string;
  nome: string;
  cnpj: string | null;
  contato: string | null;
  ativa: boolean;
};

const PATH = "/admin/transportadoras";

type Props = { initial?: Transportadora };

export function TransportadoraForm({ initial }: Props) {
  const router = useRouter();
  const create = useCreateResource<Partial<Transportadora>, Transportadora>(PATH, PATH);
  const update = useUpdateResource<Partial<Transportadora>, Transportadora>(PATH, PATH);

  const [form, setForm] = useState({
    nome: initial?.nome ?? "",
    cnpj: maskDocumento(initial?.cnpj ?? ""),
    contato: initial?.contato ?? "",
  });

  // Vazio é permitido (campo opcional); preenchido tem que fechar 11 ou 14 dígitos.
  const digitos = documentoDigits(form.cnpj);
  const documentoIncompleto =
    digitos.length > 0 && digitos.length !== 11 && digitos.length !== 14;

  async function onSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    if (documentoIncompleto) return;
    const body: Partial<Transportadora> = {
      nome: form.nome,
      cnpj: digitos || undefined,
      contato: form.contato || undefined,
    };
    if (initial) {
      await update.mutateAsync({ id: initial.id, body });
    } else {
      await create.mutateAsync(body);
    }
    router.push("/transportadoras");
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
            placeholder="Ex.: Transportes Silva"
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
            <Label>Contato</Label>
            <Input
              value={form.contato}
              onChange={(e) => setForm({ ...form, contato: e.target.value })}
              placeholder="Quem responde pela frota"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Link href="/transportadoras">
            <Button type="button" variant="outline">
              Cancelar
            </Button>
          </Link>
          <Button type="submit" disabled={saving}>
            Salvar
          </Button>
        </div>
      </form>
    </Card>
  );
}
