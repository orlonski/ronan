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
  useConsultaCep,
} from "@/components/campos-fiscais";
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
  // --- fiscais: o cliente é quem CONTRATA o frete, então é ele que vira o
  // tomador do CT-e quando não é nem o remetente nem o destinatário. Tomador
  // decide CFOP e ICMS — não é campo decorativo.
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

type Endereco = {
  logradouro: string;
  numeroEndereco: string;
  bairro: string;
  cep: string;
  municipio: string;
  uf: string;
  telefone: string;
  email: string;
};

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
  const [endereco, setEndereco] = useState<Endereco>({
    logradouro: initial?.logradouro ?? "",
    numeroEndereco: initial?.numeroEndereco ?? "",
    bairro: initial?.bairro ?? "",
    cep: initial?.cep ?? "",
    municipio: initial?.municipio ?? "",
    uf: initial?.uf ?? "",
    telefone: initial?.telefone ?? "",
    email: initial?.email ?? "",
  });
  const cep = useConsultaCep();

  async function buscarCep(valor: string) {
    const res = await cep.consultar(valor);
    if (!res) return;
    setEndereco((e) => ({
      ...e,
      logradouro: res.logradouro ?? e.logradouro,
      bairro: res.bairro ?? e.bairro,
      municipio: res.cidade,
      uf: res.uf,
      cep: res.cep ?? valor,
    }));
    // O código do IBGE vem de carona na consulta de CEP.
    if (res.codigoMunicipioIbge) {
      setFiscal((x) => ({ ...x, codigoMunicipioIbge: res.codigoMunicipioIbge! }));
    }
  }

  // Abre já expandido quando tem conteúdo: esconder o que está preenchido faz
  // o usuário achar que perdeu o dado.
  const temFiscal = temDadoFiscal(fiscal) || Object.values(endereco).some((x) => x.trim() !== "");

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
      // Endereço em branco vai como null pelo mesmo motivo dos fiscais: o CT-e
      // olha o null, e "" seria um endereço vazio de verdade no documento.
      logradouro: endereco.logradouro.trim() || null,
      numeroEndereco: endereco.numeroEndereco.trim() || null,
      bairro: endereco.bairro.trim() || null,
      cep: endereco.cep.replace(/\D/g, "") || null,
      municipio: endereco.municipio.trim() || null,
      uf: endereco.uf.trim().toUpperCase() || null,
      telefone: endereco.telefone.replace(/\D/g, "") || null,
      email: endereco.email.trim() || null,
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
        {/* O cliente é quem CONTRATA o frete. Quando ele não é o remetente nem
            o destinatário, é ele que vira o tomador do CT-e — e tomador decide
            CFOP e ICMS. Recolhido porque nem todo cliente entra em documento. */}
        <details className="rounded-md border border-border" open={temFiscal}>
          <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium">
            Dados fiscais{" "}
            <span className="font-normal text-muted-foreground">
              — preencha se esta obra vai ser o tomador do CT-e
            </span>
          </summary>
          <div className="space-y-3 border-t border-border p-3">
            <CamposFiscais
              valor={fiscal}
              onChange={setFiscal}
              uf={endereco.uf}
              prefixo="clienteform"
              papel="tomador — quem paga o frete"
            />

            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="clienteform-cep">CEP</Label>
                <Input
                  id="clienteform-cep"
                  value={endereco.cep}
                  onChange={(e) => setEndereco({ ...endereco, cep: e.target.value })}
                  onBlur={(e) => void buscarCep(e.target.value)}
                  placeholder="00000-000"
                  inputMode="numeric"
                  autoComplete="off"
                />
                <p className="text-xs text-muted-foreground">
                  {cep.buscando
                    ? "Buscando…"
                    : cep.naoEncontrado
                      ? "CEP não encontrado — preencha à mão."
                      : "Preenche o endereço e o código do município."}
                </p>
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="clienteform-logradouro">Logradouro</Label>
                <Input
                  id="clienteform-logradouro"
                  value={endereco.logradouro}
                  onChange={(e) => setEndereco({ ...endereco, logradouro: e.target.value })}
                  autoComplete="off"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <div className="space-y-2">
                <Label htmlFor="clienteform-numero">Número</Label>
                <Input
                  id="clienteform-numero"
                  value={endereco.numeroEndereco}
                  onChange={(e) => setEndereco({ ...endereco, numeroEndereco: e.target.value })}
                  autoComplete="off"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="clienteform-bairro">Bairro</Label>
                <Input
                  id="clienteform-bairro"
                  value={endereco.bairro}
                  onChange={(e) => setEndereco({ ...endereco, bairro: e.target.value })}
                  autoComplete="off"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="clienteform-municipio">Município</Label>
                <Input
                  id="clienteform-municipio"
                  value={endereco.municipio}
                  onChange={(e) => setEndereco({ ...endereco, municipio: e.target.value })}
                  autoComplete="off"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="clienteform-uf">UF</Label>
                <Input
                  id="clienteform-uf"
                  value={endereco.uf}
                  onChange={(e) =>
                    setEndereco({ ...endereco, uf: e.target.value.toUpperCase().slice(0, 2) })
                  }
                  maxLength={2}
                  autoComplete="off"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="clienteform-telefone">Telefone</Label>
                <Input
                  id="clienteform-telefone"
                  value={endereco.telefone}
                  onChange={(e) => setEndereco({ ...endereco, telefone: e.target.value })}
                  inputMode="tel"
                  autoComplete="off"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="clienteform-email">E-mail</Label>
                <Input
                  id="clienteform-email"
                  type="email"
                  value={endereco.email}
                  onChange={(e) => setEndereco({ ...endereco, email: e.target.value })}
                  autoComplete="off"
                />
              </div>
            </div>
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
