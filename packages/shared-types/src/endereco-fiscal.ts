import { z } from "zod";
import { isDocumentoValid } from "./documento";

/**
 * O município em documento fiscal.
 *
 * Documento fiscal não aceita município por nome: o CT-e, a NF-e e o MDF-e
 * querem o código de 7 dígitos do IBGE. E a checagem mais barata que existe
 * mora na própria estrutura do código — os dois primeiros dígitos são a UF.
 * Um código de outro estado é o erro clássico de importação de planilha, e ele
 * atravessa qualquer validação de formato porque tem 7 dígitos certinhos.
 *
 * Mora nos tipos compartilhados porque três lugares precisam da MESMA resposta:
 * o schema que valida o cadastro, a tela que avisa antes de salvar, e a
 * montagem do documento. Três cópias divergem; uma não.
 */

/** Código IBGE de cada UF — os dois primeiros dígitos do código do município. */
export const CODIGO_UF_IBGE: Record<string, string> = {
  RO: "11", AC: "12", AM: "13", RR: "14", PA: "15", AP: "16", TO: "17",
  MA: "21", PI: "22", CE: "23", RN: "24", PB: "25", PE: "26", AL: "27",
  SE: "28", BA: "29", MG: "31", ES: "32", RJ: "33", SP: "35", PR: "41",
  SC: "42", RS: "43", MS: "50", MT: "51", GO: "52", DF: "53",
};

export function ufExiste(uf: string): boolean {
  return CODIGO_UF_IBGE[(uf ?? "").toUpperCase()] !== undefined;
}

/**
 * O código tem 7 dígitos E começa pelo código da UF informada.
 *
 * UF desconhecida devolve `false`: não dá pra afirmar que bate com um estado
 * que não existe.
 */
export function municipioBateComUf(codigoMunicipio: string, uf: string): boolean {
  const cod = (codigoMunicipio ?? "").replace(/\D/g, "");
  const cUF = CODIGO_UF_IBGE[(uf ?? "").toUpperCase()];
  return cod.length === 7 && cUF !== undefined && cod.startsWith(cUF);
}

/** A explicação que se mostra pra quem digitou errado. */
export function motivoMunicipioNaoBate(codigoMunicipio: string, uf: string): string {
  const cUF = CODIGO_UF_IBGE[(uf ?? "").toUpperCase()];
  const cod = (codigoMunicipio ?? "").replace(/\D/g, "");
  if (cod.length !== 7) return `O código IBGE precisa ter 7 dígitos (veio "${codigoMunicipio}").`;
  if (!cUF) return `UF desconhecida: "${uf}".`;
  return `O código IBGE ${cod} não é de ${uf.toUpperCase()} — ele começaria com ${cUF}.`;
}

/**
 * Os campos que fazem de um cadastro uma PESSOA no documento fiscal.
 *
 * Local, cliente e empresa precisam exatamente dos mesmos campos e erram
 * exatamente do mesmo jeito: no CT-e, o local de carga vira o remetente, o de
 * descarga vira o destinatário e o cliente pode virar o tomador. Uma definição
 * só, porque três cópias divergem na primeira correção.
 *
 * Tudo opcional: a maioria dos cadastros nunca entra num documento (um ponto de
 * parada, uma balança), e exigir CNPJ de todos travaria o cadastro do dia a dia
 * por causa de um uso que talvez nunca aconteça.
 */
export const CamposFiscais = {
  /** CNPJ ou CPF de quem opera o local. Vazio = local sem uso fiscal. */
  cnpjCpf: z.string().trim().max(20).optional().nullable(),
  /**
   * A razão social, que costuma ser diferente do nome que o motorista usa
   * ("Pedreira do Zé" no dia a dia, "Mineração Santa Rita Ltda" no documento).
   * 60 é o teto do `xNome` no leiaute — cortar aqui evita rejeição depois.
   */
  razaoSocialFiscal: z.string().trim().max(60).optional().nullable(),
  inscricaoEstadual: z.string().trim().max(18).optional().nullable(),
  /** 1 contribuinte · 2 contribuinte isento · 9 não contribuinte. */
  indicadorIe: z.enum(["1", "2", "9"]).optional().nullable(),
  /** Código IBGE de 7 dígitos. Documento fiscal não aceita município por nome. */
  codigoMunicipioIbge: z
    .string()
    .trim()
    .regex(/^\d{7}$/, "O código IBGE tem 7 dígitos.")
    .optional()
    .nullable(),
};

/**
 * As conferências que dependem de mais de um campo.
 *
 * Reaproveitável porque local, cliente e empresa têm exatamente os mesmos
 * campos e exatamente os mesmos jeitos de errar.
 */
export function conferirCamposFiscais(
  v: {
    cnpjCpf?: string | null;
    indicadorIe?: string | null;
    inscricaoEstadual?: string | null;
    codigoMunicipioIbge?: string | null;
    uf?: string | null;
  },
  ctx: z.RefinementCtx,
): void {
  if (v.cnpjCpf && !isDocumentoValid(v.cnpjCpf)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["cnpjCpf"],
      message: "CNPJ ou CPF inválido — confira os dígitos.",
    });
  }
  // Contribuinte sem IE é rejeição na SEFAZ, e o cadastro é o lugar barato de
  // descobrir isso.
  if (v.indicadorIe === "1" && !v.inscricaoEstadual?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["inscricaoEstadual"],
      message: "Contribuinte de ICMS precisa de inscrição estadual.",
    });
  }
  // E o contrário também: quem não é contribuinte não pode levar IE.
  if (v.indicadorIe === "9" && v.inscricaoEstadual?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["inscricaoEstadual"],
      message: "Quem não é contribuinte de ICMS não deve ter inscrição estadual.",
    });
  }
  if (v.codigoMunicipioIbge && v.uf && !municipioBateComUf(v.codigoMunicipioIbge, v.uf)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["codigoMunicipioIbge"],
      message: motivoMunicipioNaoBate(v.codigoMunicipioIbge, v.uf),
    });
  }
}

/**
 * O objeto sem as conferências cruzadas.
 *
 * Existe separado porque `superRefine` devolve um `ZodEffects`, que não tem
 * `.partial()` — e a edição precisa aceitar campo solto. As duas pontas saem
 * DAQUI pra não divergirem.
 */
