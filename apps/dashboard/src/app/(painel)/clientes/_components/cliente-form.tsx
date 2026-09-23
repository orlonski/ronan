"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { TagInput } from "@/components/ui/tag-input";
import {
  useCreateResource,
  useResourceOptions,
  useUpdateResource,
} from "@/lib/client-api";
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
import { useSujo } from "@/hooks/use-sujo";
import { BotaoCancelar, useAvisarSeSujo } from "@/components/sair-sem-salvar";

type Empresa = { id: string; nome: string };
export type Cliente = {
  id: string;
  nome: string;
  ativa: boolean;
  empresa: Empresa;
  empresaId: string;
  apelidos: string[];
  // --- fiscais: este cadastro é a OBRA (na tela). Só vira tomador do CT-e
  // quando tem CNPJ próprio (filial, consórcio, SPE); senão o tomador é o
  // cliente que paga. Tomador decide CFOP e ICMS — não é campo decorativo.
  cnpjCpf: string | null;
  razaoSocialFiscal: string | null;
  inscricaoEstadual: string | null;
  indicadorIe: string | null;
  codigoMunicipioIbge: string | null;
  logradouro: string | null;
  numeroEndereco: string | null;
  bairro: string | null;
  cep: string | null;
  municipio: string | null;
  uf: string | null;
  telefone: string | null;
  email: string | null;
};

const PATH = "/admin/clientes";
const EMPRESAS_PATH = "/admin/empresas";

type Props = { initial?: Cliente };

type ClienteBody = Record<string, unknown>;

export function ClienteForm({ initial }: Props) {
  const router = useRouter();
  const empresas = useResourceOptions<Empresa>(EMPRESAS_PATH);
  const create = useCreateResource<ClienteBody, Cliente>(PATH, PATH);
  const update = useUpdateResource<Partial<ClienteBody>, Cliente>(PATH, PATH);

  const [form, setForm] = useState({
    nome: initial?.nome ?? "",
    empresaId: initial?.empresaId ?? "",
    apelidos: initial?.apelidos ?? ([] as string[]),
  });
  const [fiscal, setFiscal] = useState(fiscalDe(initial));
  const [endereco, setEndereco] = useState(enderecoDe(initial));

  // Abre já expandido quando tem conteúdo: esconder o que está preenchido faz
  // o usuário achar que perdeu o dado.
  const temFiscal = temDadoFiscal(fiscal) || temEndereco(endereco);

  // Sair de um cadastro longo descartava tudo em silêncio.
  const sujo = useSujo({ ...form, ...fiscal, ...endereco });
  useAvisarSeSujo(sujo);

  useEffect(() => {
    if (initial || form.empresaId || !empresas.data?.[0]?.id) return;
    setForm((f) => ({ ...f, empresaId: empresas.data![0]!.id }));
  }, [initial, form.empresaId, empresas.data]);

  async function onSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    const body: ClienteBody = {
      nome: form.nome,
      empresaId: form.empresaId,
      apelidos: form.apelidos,
      ...fiscalParaEnvio(fiscal),
      ...enderecoParaEnvio(endereco, { comTelefone: true }),
    };
    if (initial) {
      await update.mutateAsync({ id: initial.id, body });
    } else {
      await create.mutateAsync(body);
    }
    router.push("/clientes");
  }

  const saving = create.isPending || update.isPending;

  return (
    <Card className="p-6">
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="clientefor-nome">Nome</Label>
          <Input id="clientefor-nome"
            required
            autoFocus
            value={form.nome}
            onChange={(e) => setForm({ ...form, nome: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="clientefor-empresa">Cliente</Label>
          <Select id="clientefor-empresa"
            required
            value={form.empresaId}
            onChange={(e) => setForm({ ...form, empresaId: e.target.value })}
          >
            {empresas.data?.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nome}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Apelidos do motorista</Label>
          <TagInput
            value={form.apelidos}
            onChange={(arr) => setForm({ ...form, apelidos: arr })}
            placeholder='ex: "obra do beto", "shopping novo"'
          />
          <p className="text-xs text-muted-foreground">
            Como o motorista chama no WhatsApp/áudio. O agente IA usa pra
            achar a obra quando ele escreve diferente do cadastro.
          </p>
        </div>
        {/* O tomador do CT-e é o cliente que paga. A obra só entra no lugar dele
            quando tem CNPJ próprio (filial, consórcio, SPE) — ver
            common/cte/tomador.ts. Recolhido porque quase nenhuma obra tem. */}
        <details className="rounded-md border border-border" open={temFiscal}>
          <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium">
            Dados fiscais{" "}
            <span className="font-normal text-muted-foreground">
              — só se esta obra tem CNPJ próprio (filial, consórcio, SPE); senão o CT-e usa o do cliente
            </span>
          </summary>
          <div className="space-y-3 border-t border-border p-3">
            <CamposFiscais
              valor={fiscal}
              onChange={setFiscal}
              uf={endereco.uf}
              prefixo="clienteform"
              papel="tomador no lugar do cliente, quando a obra tem CNPJ próprio"
            />

            <EnderecoCadastro
              valor={endereco}
              onChange={setEndereco}
              prefixo="clienteform"
              onCodigoIbge={(codigo) => setFiscal((x) => ({ ...x, codigoMunicipioIbge: codigo }))}
            />
          </div>
        </details>

        <div className="flex justify-end gap-2 pt-2">
          <BotaoCancelar href="/clientes" sujo={sujo} />
          <Button type="submit" disabled={saving}>
            Salvar
          </Button>
        </div>
      </form>
    </Card>
  );
}
