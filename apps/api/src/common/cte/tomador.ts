import { soDigitos } from "../chave-fiscal";
import type { Participante, PapelTomador } from "./montar";

/**
 * QUEM É O TOMADOR DO CT-e — quem paga o frete.
 *
 * Na tela, o "Cliente" é quem paga (o model `Empresa`) e a "Obra" é onde se
 * trabalha (o model `Cliente`). Até 23/09/2026 o tomador saía da OBRA, e os
 * dados fiscais do cliente que paga nem eram lidos — com o cadastro de obra sem
 * CNPJ (todas, em produção), o documento caía sempre no destinatário. A regra
 * certa é tomador = quem paga.
 *
 * A ordem:
 *  1. A OBRA, se ela tem CNPJ próprio. Construtora grande abre CNPJ por obra
 *     (filial, consórcio, SPE), e quem preenche o CNPJ da obra está dizendo
 *     que é ESSE CNPJ que paga. Explícito vence o geral.
 *  2. O CLIENTE que paga, com o cadastro fiscal dele.
 *  3. Ninguém com CNPJ: o destinatário — o caso mais comum no granel, com a
 *     obra/construtora pagando o frete. É o comportamento de antes.
 *
 * Se o CNPJ escolhido é o do remetente ou do destinatário, o tomador é aquele
 * papel (toma3); senão vai como "outros" (toma4), com endereço completo.
 * Função pura: a escolha é fiscal e se testa sem banco.
 */

type Endereco = {
  logradouro: string | null;
  numeroEndereco: string | null;
  bairro: string | null;
  codigoMunicipioIbge: string | null;
  municipio: string | null;
  cep: string | null;
  uf: string | null;
};

/** O cliente que paga (model `Empresa`): o CNPJ mora em `cnpj`, a razão em `razaoSocial`. */
export type PagadorFiscal = Endereco & {
  nome: string;
  cnpj: string | null;
  razaoSocial: string | null;
  inscricaoEstadual: string | null;
  indicadorIe: string | null;
  email: string | null;
};

/** A obra (model `Cliente`): o CNPJ mora em `cnpjCpf`, a razão em `razaoSocialFiscal`. */
export type ObraFiscal = Endereco & {
  nome: string;
  cnpjCpf: string | null;
  razaoSocialFiscal: string | null;
  inscricaoEstadual: string | null;
  indicadorIe: string | null;
  telefone: string | null;
  email: string | null;
};

export type EscolhaTomador = {
  papelTomador: PapelTomador;
  tomadorOutro: Participante | null;
  /** De onde saiu — pra explicar na prévia e nos testes. */
  origem: "OBRA" | "CLIENTE" | "DESTINATARIO";
};

export function escolherTomador(args: {
  obra: ObraFiscal | null;
  pagador: PagadorFiscal | null;
  remetente: Participante;
  destinatario: Participante;
}): EscolhaTomador {
  const { obra, pagador, remetente, destinatario } = args;

  let candidato: { participante: Participante; origem: "OBRA" | "CLIENTE" } | null = null;
  if (obra?.cnpjCpf && soDigitos(obra.cnpjCpf)) {
    candidato = {
      origem: "OBRA",
      participante: {
        cnpjCpf: soDigitos(obra.cnpjCpf),
        razaoSocial: obra.razaoSocialFiscal?.trim() || obra.nome,
        inscricaoEstadual: obra.inscricaoEstadual,
        indicadorIe: (obra.indicadorIe as "1" | "2" | "9") ?? "9",
        endereco: enderecoDe(obra),
        telefone: obra.telefone,
        email: obra.email,
      },
    };
  } else if (pagador?.cnpj && soDigitos(pagador.cnpj)) {
    candidato = {
      origem: "CLIENTE",
      participante: {
        cnpjCpf: soDigitos(pagador.cnpj),
        // Mesma regra do local e da obra: a razão social manda, o nome
        // comercial só entra quando ela está em branco.
        razaoSocial: pagador.razaoSocial?.trim() || pagador.nome,
        inscricaoEstadual: pagador.inscricaoEstadual,
        indicadorIe: (pagador.indicadorIe as "1" | "2" | "9") ?? "9",
        endereco: enderecoDe(pagador),
        // O cadastro de cliente não tem telefone (tem "Contato", texto livre).
        telefone: null,
        email: pagador.email,
      },
    };
  }

  if (!candidato) return { papelTomador: "DESTINATARIO", tomadorOutro: null, origem: "DESTINATARIO" };

  const doc = candidato.participante.cnpjCpf;
  if (doc === soDigitos(remetente.cnpjCpf)) {
    return { papelTomador: "REMETENTE", tomadorOutro: null, origem: candidato.origem };
  }
  if (doc === soDigitos(destinatario.cnpjCpf)) {
    return { papelTomador: "DESTINATARIO", tomadorOutro: null, origem: candidato.origem };
  }
  return { papelTomador: "OUTRO", tomadorOutro: candidato.participante, origem: candidato.origem };
}

function enderecoDe(e: Endereco): Participante["endereco"] {
  return {
    logradouro: e.logradouro ?? "",
    numero: e.numeroEndereco ?? "S/N",
    bairro: e.bairro ?? "",
    codigoMunicipio: e.codigoMunicipioIbge ?? "",
    municipio: e.municipio ?? "",
    cep: e.cep,
    uf: e.uf ?? "",
  };
}
