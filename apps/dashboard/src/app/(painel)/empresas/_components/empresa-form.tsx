"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useCreateResource, useUpdateResource } from "@/lib/client-api";
import { documentoDigits, maskDocumento } from "@ronan/shared-types";
import { useSujo } from "@/hooks/use-sujo";
import { BotaoCancelar, useAvisarSeSujo } from "@/components/sair-sem-salvar";
import {
  CamposFiscais,
  fiscalDe,
  fiscalParaEnvio,
  temDadoFiscal,
} from "@/components/campos-fiscais";
import {
  EnderecoCadastro,
  enderecoDe,
  enderecoParaEnvio,
  temEndereco,
} from "@/components/endereco-cadastro";

type Papel = "RECEBE_PLANILHA" | "MANDA_FECHAMENTO" | "AMBOS";
export type Empresa = {
  id: string;
  nome: string;
  cnpj: string | null;
  contato: string | null;
  papel: Papel;
  ativa: boolean;
  // --- fiscais: quem paga o frete. As colunas têm os nomes da tabela
  // `empresas` (razaoSocial, sem o "Fiscal" do cadastro de obra).
  razaoSocial: string | null;
  inscricaoEstadual: string | null;
  indicadorIe: string | null;
  codigoMunicipioIbge: string | null;
  logradouro: string | null;
  numeroEndereco: string | null;
  bairro: string | null;
  cep: string | null;
  municipio: string | null;
  uf: string | null;
  email: string | null;
};

const PATH = "/admin/empresas";

type Props = { initial?: Empresa };

export function EmpresaForm({ initial }: Props) {
  const router = useRouter();
  const create = useCreateResource<Record<string, unknown>, Empresa>(PATH, PATH);
  const update = useUpdateResource<Record<string, unknown>, Empresa>(PATH, PATH);

  const [form, setForm] = useState({
    nome: initial?.nome ?? "",
    cnpj: maskDocumento(initial?.cnpj ?? ""),
    contato: initial?.contato ?? "",
    papel: (initial?.papel ?? "AMBOS") as Papel,
  });

  // O componente fiscal é o mesmo do cadastro de obra, que chama a razão
  // social de `razaoSocialFiscal`; aqui ela mora em `razaoSocial`. O CNPJ fica
  // no campo do topo — o componente esconde o dele.
  const [fiscal, setFiscal] = useState(
    fiscalDe({ ...initial, cnpjCpf: null, razaoSocialFiscal: initial?.razaoSocial ?? null }),
  );
  const [endereco, setEndereco] = useState(enderecoDe(initial));
  // Aberto quando já tem conteúdo: esconder o que está preenchido faz o
  // usuário achar que perdeu o dado.
  const temFiscal = temDadoFiscal(fiscal) || temEndereco(endereco);

  // Sair de um cadastro longo descartava tudo em silêncio.
  const sujo = useSujo({ ...form, ...fiscal, ...endereco });
  useAvisarSeSujo(sujo);

  // Vazio é permitido (campo opcional); preenchido tem que fechar 11 ou 14 dígitos.
  const digitos = documentoDigits(form.cnpj);
  const documentoIncompleto =
    digitos.length > 0 && digitos.length !== 11 && digitos.length !== 14;

  async function onSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    if (documentoIncompleto) return;
    const { cnpjCpf: _semDocumento, razaoSocialFiscal, ...resto } = fiscalParaEnvio(fiscal);
    const body: Record<string, unknown> = {
      nome: form.nome,
      cnpj: digitos || undefined,
      contato: form.contato || undefined,
      papel: form.papel,
      razaoSocial: razaoSocialFiscal,
      ...resto,
      ...enderecoParaEnvio(endereco, { comTelefone: false }),
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
          <Label htmlFor="empresafor-nome">Nome</Label>
          <Input id="empresafor-nome"
            required
            autoFocus
            value={form.nome}
            onChange={(e) => setForm({ ...form, nome: e.target.value })}
          />
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="empresafor-cnpj-ou-cpf">CNPJ ou CPF</Label>
            <Input id="empresafor-cnpj-ou-cpf"
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
            <Label htmlFor="empresafor-papel">Papel</Label>
            <Select id="empresafor-papel"
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
          <Label htmlFor="empresafor-contato">Contato</Label>
          <Input id="empresafor-contato"
            value={form.contato}
            onChange={(e) => setForm({ ...form, contato: e.target.value })}
          />
        </div>
        {/* Quem paga o frete é o tomador do CT-e — e tomador decide CFOP e
            ICMS. Recolhido porque nem todo cliente entra em documento. */}
        <details className="rounded-md border border-border" open={temFiscal}>
          <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium">
            Dados fiscais{" "}
            <span className="font-normal text-muted-foreground">
              — o que vai no documento fiscal de quem paga o frete
            </span>
          </summary>
          <div className="space-y-3 border-t border-border p-3">
            <CamposFiscais
              valor={fiscal}
              onChange={setFiscal}
              uf={endereco.uf}
              prefixo="empresaform"
              papel="tomador — quem paga o frete"
              mostrarDocumento={false}
            />
            <EnderecoCadastro
              valor={endereco}
              onChange={setEndereco}
              prefixo="empresaform"
              comTelefone={false}
              onCodigoIbge={(codigo) => setFiscal((x) => ({ ...x, codigoMunicipioIbge: codigo }))}
            />
          </div>
        </details>

        <div className="flex justify-end gap-2 pt-2">
          <BotaoCancelar href="/empresas" sujo={sujo} />
          <Button type="submit" disabled={saving || documentoIncompleto}>
            Salvar
          </Button>
        </div>
      </form>
    </Card>
  );
}
