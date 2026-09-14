"use client";

import * as React from "react";
import { CODIGO_UF_IBGE, municipioBateComUf } from "@ronan/shared-types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { fetchApi, useAuthToken } from "@/lib/client-api";

/**
 * O que transforma um cadastro numa PESSOA do documento fiscal.
 *
 * Local, cliente e empresa precisam dos mesmos cinco campos e erram do mesmo
 * jeito. Um componente só, porque três cópias divergem na primeira correção — e
 * porque a explicação de cada campo (por que a razão social não é o apelido,
 * por que existe código de município) só precisa ser escrita bem uma vez.
 */

export type ValorFiscal = {
  cnpjCpf: string;
  razaoSocialFiscal: string;
  inscricaoEstadual: string;
  indicadorIe: string;
  codigoMunicipioIbge: string;
};

export const FISCAL_VAZIO: ValorFiscal = {
  cnpjCpf: "",
  razaoSocialFiscal: "",
  inscricaoEstadual: "",
  indicadorIe: "",
  codigoMunicipioIbge: "",
};

/** Traz de volta o que está guardado, tratando null como vazio. */
export function fiscalDe(o: Partial<Record<keyof ValorFiscal, string | null>> | undefined): ValorFiscal {
  return {
    cnpjCpf: o?.cnpjCpf ?? "",
    razaoSocialFiscal: o?.razaoSocialFiscal ?? "",
    inscricaoEstadual: o?.inscricaoEstadual ?? "",
    indicadorIe: o?.indicadorIe ?? "",
    codigoMunicipioIbge: o?.codigoMunicipioIbge ?? "",
  };
}

/** Tem alguma coisa preenchida? Decide se a seção abre recolhida ou aberta. */
export function temDadoFiscal(v: ValorFiscal): boolean {
  return Object.values(v).some((x) => x.trim() !== "");
}

/**
 * O que vai pro corpo da requisição.
 *
 * Campo em branco vira `null` e não `""`: o banco distingue "não preenchido" de
 * "vazio", e as regras do CT-e olham o null.
 */
export function fiscalParaEnvio(v: ValorFiscal) {
  return {
    cnpjCpf: v.cnpjCpf.replace(/\D/g, "") || null,
    razaoSocialFiscal: v.razaoSocialFiscal.trim() || null,
    inscricaoEstadual: v.inscricaoEstadual.replace(/[^0-9A-Za-z]/g, "") || null,
    indicadorIe: v.indicadorIe || null,
    codigoMunicipioIbge: v.codigoMunicipioIbge.replace(/\D/g, "") || null,
  };
}

export type RespostaCep = {
  logradouro?: string;
  bairro?: string;
  cidade: string;
  uf: string;
  cep?: string;
  /** O ViaCEP entrega junto. É de graça, e documento fiscal exige. */
  codigoMunicipioIbge?: string;
};

/**
 * Consulta de CEP.
 *
 * Vale um hook porque o valor não é o endereço — é o CÓDIGO DO MUNICÍPIO que
 * vem de carona. Digitado à mão ele é um número de sete dígitos que ninguém
 * sabe de cabeça e que ninguém confere; vindo do CEP, ele já está certo antes
 * de alguém reparar que existe.
 */
export function useConsultaCep() {
  const token = useAuthToken();
  const [buscando, setBuscando] = React.useState(false);
  const [naoEncontrado, setNaoEncontrado] = React.useState(false);

  const consultar = React.useCallback(
    async (cepRaw: string): Promise<RespostaCep | null> => {
      const cep = (cepRaw ?? "").replace(/\D/g, "");
      if (cep.length !== 8 || !token) return null;
      setBuscando(true);
      setNaoEncontrado(false);
      try {
        const res = await fetchApi<RespostaCep | null>(`/geocoding/cep?cep=${cep}`, { token });
        if (!res) setNaoEncontrado(true);
        return res;
      } catch {
        setNaoEncontrado(true);
        return null;
      } finally {
        setBuscando(false);
      }
    },
    [token],
  );

  return { consultar, buscando, naoEncontrado };
}

export function CamposFiscais({
  valor,
  onChange,
  uf,
  prefixo,
  papel,
}: {
  valor: ValorFiscal;
  onChange: (v: ValorFiscal) => void;
  /** A UF do cadastro — é contra ela que o código do município é conferido. */
  uf: string;
  /** Prefixo dos `id` dos campos, pra dois formulários na mesma página não colidirem. */
  prefixo: string;
  /** O que este cadastro vira no documento. Muda só o texto. */
  papel: string;
}) {
  const set = (p: Partial<ValorFiscal>) => onChange({ ...valor, ...p });
  const semIe = valor.indicadorIe === "2" || valor.indicadorIe === "9";

  // null = nada a dizer. false = código de outro estado — o erro clássico de
  // importação de planilha, que passa por qualquer validação de formato.
  const ibgeConfere =
    valor.codigoMunicipioIbge.replace(/\D/g, "").length === 7 && uf
      ? municipioBateComUf(valor.codigoMunicipioIbge, uf)
      : null;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${prefixo}-cnpj`}>CNPJ ou CPF</Label>
          <Input
            id={`${prefixo}-cnpj`}
            value={valor.cnpjCpf}
            onChange={(e) => set({ cnpjCpf: e.target.value })}
            placeholder="00.000.000/0000-00"
            inputMode="numeric"
            autoComplete="off"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${prefixo}-razao`}>Razão social</Label>
          <Input
            id={`${prefixo}-razao`}
            value={valor.razaoSocialFiscal}
            onChange={(e) => set({ razaoSocialFiscal: e.target.value })}
            placeholder="o nome do contrato social"
            maxLength={60}
            autoComplete="off"
          />
          <p className="text-xs text-muted-foreground">
            O documento leva este nome, não o apelido do dia a dia. Em branco,
            usa o nome do cadastro.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${prefixo}-indie`}>Contribuinte de ICMS</Label>
          <Select
            id={`${prefixo}-indie`}
            value={valor.indicadorIe}
            onChange={(e) =>
              set({
                indicadorIe: e.target.value,
                // Trocar pra "não contribuinte" e deixar a IE preenchida é
                // rejeição na SEFAZ. Limpar aqui evita salvar a contradição.
                ...(e.target.value === "2" || e.target.value === "9"
                  ? { inscricaoEstadual: "" }
                  : {}),
              })
            }
          >
            <option value="">Não informar</option>
            <option value="1">Sim — tem inscrição estadual</option>
            <option value="2">Isento de inscrição estadual</option>
            <option value="9">Não é contribuinte</option>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${prefixo}-ie`}>Inscrição estadual</Label>
          <Input
            id={`${prefixo}-ie`}
            value={valor.inscricaoEstadual}
            onChange={(e) => set({ inscricaoEstadual: e.target.value })}
            disabled={semIe}
            placeholder={semIe ? "não se aplica" : ""}
            autoComplete="off"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${prefixo}-ibge`}>Código IBGE do município</Label>
        <Input
          id={`${prefixo}-ibge`}
          value={valor.codigoMunicipioIbge}
          onChange={(e) => set({ codigoMunicipioIbge: e.target.value })}
          placeholder="7 dígitos"
          inputMode="numeric"
          maxLength={7}
          autoComplete="off"
          aria-invalid={ibgeConfere === false}
        />
        <p className={`text-xs ${ibgeConfere === false ? "text-destructive" : "text-muted-foreground"}`}>
          {ibgeConfere === false
            ? `Esse código não é de ${uf.toUpperCase()} — os de ${uf.toUpperCase()} começam com ${CODIGO_UF_IBGE[uf.toUpperCase()] ?? "??"}.`
            : `Preenchido sozinho quando você busca o CEP. Documento fiscal não aceita município por nome — e no CT-e este cadastro vira o ${papel}.`}
        </p>
      </div>
    </div>
  );
}
