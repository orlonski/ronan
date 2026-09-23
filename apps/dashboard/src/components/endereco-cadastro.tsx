"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useConsultaCep } from "@/components/campos-fiscais";

/**
 * O endereço de quem entra num documento fiscal: CEP (que preenche o resto),
 * logradouro, número, bairro, município, UF e contato.
 *
 * Saiu do cadastro de obra quando o cadastro de cliente (quem paga) também
 * passou a precisar dele — duas cópias do mesmo bloco divergem na primeira
 * correção, como já tinha acontecido com os campos fiscais.
 */
export type ValorEndereco = {
  logradouro: string;
  numeroEndereco: string;
  bairro: string;
  cep: string;
  municipio: string;
  uf: string;
  telefone: string;
  email: string;
};

export function enderecoDe(
  o: Partial<Record<keyof ValorEndereco, string | null>> | undefined,
): ValorEndereco {
  return {
    logradouro: o?.logradouro ?? "",
    numeroEndereco: o?.numeroEndereco ?? "",
    bairro: o?.bairro ?? "",
    cep: o?.cep ?? "",
    municipio: o?.municipio ?? "",
    uf: o?.uf ?? "",
    telefone: o?.telefone ?? "",
    email: o?.email ?? "",
  };
}

export function temEndereco(v: ValorEndereco): boolean {
  return Object.values(v).some((x) => x.trim() !== "");
}

/**
 * O que vai pro corpo da requisição. Em branco vai como null: o CT-e olha o
 * null, e "" seria um endereço vazio de verdade no documento.
 */
export function enderecoParaEnvio(v: ValorEndereco, opts: { comTelefone: boolean }) {
  return {
    logradouro: v.logradouro.trim() || null,
    numeroEndereco: v.numeroEndereco.trim() || null,
    bairro: v.bairro.trim() || null,
    cep: v.cep.replace(/\D/g, "") || null,
    municipio: v.municipio.trim() || null,
    uf: v.uf.trim().toUpperCase() || null,
    ...(opts.comTelefone ? { telefone: v.telefone.replace(/\D/g, "") || null } : {}),
    email: v.email.trim() || null,
  };
}

export function EnderecoCadastro({
  valor,
  onChange,
  prefixo,
  onCodigoIbge,
  comTelefone = true,
}: {
  valor: ValorEndereco;
  onChange: (v: ValorEndereco) => void;
  /** Prefixo dos `id` dos campos, pra dois formulários na mesma página não colidirem. */
  prefixo: string;
  /** O código do IBGE vem de carona na consulta de CEP. */
  onCodigoIbge: (codigo: string) => void;
  /** O cadastro de cliente não tem coluna de telefone (tem "Contato"). */
  comTelefone?: boolean;
}) {
  const cep = useConsultaCep();
  const set = (p: Partial<ValorEndereco>) => onChange({ ...valor, ...p });

  async function buscarCep(texto: string) {
    const res = await cep.consultar(texto);
    if (!res) return;
    onChange({
      ...valor,
      logradouro: res.logradouro ?? valor.logradouro,
      bairro: res.bairro ?? valor.bairro,
      municipio: res.cidade,
      uf: res.uf,
      cep: res.cep ?? texto,
    });
    if (res.codigoMunicipioIbge) onCodigoIbge(res.codigoMunicipioIbge);
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor={`${prefixo}-cep`}>CEP</Label>
          <Input
            id={`${prefixo}-cep`}
            value={valor.cep}
            onChange={(e) => set({ cep: e.target.value })}
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
          <Label htmlFor={`${prefixo}-logradouro`}>Logradouro</Label>
          <Input
            id={`${prefixo}-logradouro`}
            value={valor.logradouro}
            onChange={(e) => set({ logradouro: e.target.value })}
            autoComplete="off"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <div className="space-y-2">
          <Label htmlFor={`${prefixo}-numero`}>Número</Label>
          <Input
            id={`${prefixo}-numero`}
            value={valor.numeroEndereco}
            onChange={(e) => set({ numeroEndereco: e.target.value })}
            autoComplete="off"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${prefixo}-bairro`}>Bairro</Label>
          <Input
            id={`${prefixo}-bairro`}
            value={valor.bairro}
            onChange={(e) => set({ bairro: e.target.value })}
            autoComplete="off"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${prefixo}-municipio`}>Município</Label>
          <Input
            id={`${prefixo}-municipio`}
            value={valor.municipio}
            onChange={(e) => set({ municipio: e.target.value })}
            autoComplete="off"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${prefixo}-uf`}>UF</Label>
          <Input
            id={`${prefixo}-uf`}
            value={valor.uf}
            onChange={(e) => set({ uf: e.target.value.toUpperCase().slice(0, 2) })}
            maxLength={2}
            autoComplete="off"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {comTelefone && (
          <div className="space-y-2">
            <Label htmlFor={`${prefixo}-telefone`}>Telefone</Label>
            <Input
              id={`${prefixo}-telefone`}
              value={valor.telefone}
              onChange={(e) => set({ telefone: e.target.value })}
              inputMode="tel"
              autoComplete="off"
            />
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor={`${prefixo}-email`}>E-mail</Label>
          <Input
            id={`${prefixo}-email`}
            type="email"
            value={valor.email}
            onChange={(e) => set({ email: e.target.value })}
            autoComplete="off"
          />
        </div>
      </div>
    </>
  );
}
