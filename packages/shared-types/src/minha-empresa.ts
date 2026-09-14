import { z } from "zod";

/**
 * O que a TRANSPORTADORA edita sobre ela mesma (tela "Minha empresa").
 *
 * Arquivo separado de `empresa.ts` de propósito. `Empresa` lá é a CONTRAPARTE —
 * a pedreira/obra que manda ou recebe a planilha de fechamento. Aqui é a `Conta`,
 * quem assina o sistema. As duas se chamando "empresa" já fez a exigência de foto
 * nascer no eixo errado uma vez; manter os contratos em arquivos distintos é
 * barato e evita a próxima.
 */
const texto = (max: number) => z.string().trim().max(max).nullish();

export const AtualizarMinhaEmpresaInput = z.object({
  // Exigir a FOTO do comprovante no lançamento. Não confundir com
  // Material.exigeTicket, que é o NÚMERO do ticket.
  exigeFotoViagem: z.boolean().optional(),
  exigeFotoAbastecimento: z.boolean().optional(),

  // --- identidade fiscal ---
  // Estes campos existiam no banco desde a fase 0 e não tinham tela nenhuma:
  // dava pra guardá-los e não dava pra preenchê-los. A tela de emissão de CT-e
  // mandava o usuário pra "Minha empresa" procurar o que não estava lá.
  cnpj: z
    .string()
    .trim()
    .transform((v) => v.replace(/\D/g, ""))
    .refine((v) => v === "" || v.length === 14, "O CNPJ tem 14 números")
    .nullish(),
  razaoSocial: texto(120),
  inscricaoEstadual: texto(20),
  inscricaoMunicipal: texto(20),
  /// 1 Simples Nacional · 2 Simples com excesso de sublimite · 3 Regime Normal.
  crt: z.enum(["1", "2", "3"]).nullish(),
  logradouro: texto(160),
  numero: texto(10),
  complemento: texto(60),
  bairro: texto(60),
  cep: z
    .string()
    .trim()
    .transform((v) => v.replace(/\D/g, ""))
    .refine((v) => v === "" || v.length === 8, "O CEP tem 8 números")
    .nullish(),
  municipio: texto(120),
  /// Código IBGE de 7 dígitos. O CT-e não aceita município por nome.
  codigoMunicipioIbge: z
    .string()
    .trim()
    .transform((v) => v.replace(/\D/g, ""))
    .refine((v) => v === "" || v.length === 7, "O código IBGE tem 7 números")
    .nullish(),
  uf: z.string().trim().toUpperCase().length(2).nullish().or(z.literal("")),
  telefoneFiscal: texto(20),
  /// Registro na ANTT. Sem ele não há CT-e, MDF-e nem CIOT.
  rntrc: texto(20),
  /// ETC (empresa), CTC (cooperativa) ou TAC (autônomo).
  tipoTransportador: z.enum(["ETC", "CTC", "TAC"]).nullish(),
});
export type AtualizarMinhaEmpresaInput = z.infer<typeof AtualizarMinhaEmpresaInput>;
