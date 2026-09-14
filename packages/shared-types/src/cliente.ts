import { z } from "zod";
import { CamposFiscais, conferirCamposFiscais } from "./endereco-fiscal";

// Mínimos de km/toneladas foram aposentados aqui — agora são regras por faixa
// (RegraMinimo, empresa+material+faixa de km). Ver packages/shared-types/regra-minimo.ts.

/**
 * O endereço do cliente.
 *
 * Existe porque o cliente pode ser o TOMADOR do CT-e — quem paga o frete — e o
 * tomador entra no documento com endereço completo quando não é nenhum dos
 * outros participantes. O nome do campo de número é `numeroEndereco` e não
 * `numero` porque no banco ele já nasceu assim; renomear quebraria a coluna sem
 * ganhar nada.
 */
const EnderecoCliente = {
  logradouro: z.string().trim().max(160).optional().nullable(),
  numeroEndereco: z.string().trim().max(20).optional().nullable(),
  bairro: z.string().trim().max(120).optional().nullable(),
  cep: z.string().trim().regex(/^\d{5}-?\d{3}$/, "CEP inválido.").optional().nullable(),
  municipio: z.string().trim().max(120).optional().nullable(),
  uf: z.string().trim().length(2).optional().nullable(),
  telefone: z.string().trim().max(20).optional().nullable(),
  email: z.string().trim().email("E-mail inválido.").max(160).optional().nullable(),
};

const ClienteBase = z.object({
  nome: z.string().min(2).max(160),
  empresaId: z.string().uuid(),
  apelidos: z.array(z.string().min(1).max(60)).max(20).default([]),
  ...CamposFiscais,
  ...EnderecoCliente,
});

export const CriarClienteInput = ClienteBase.superRefine((v, ctx) =>
  conferirCamposFiscais(v, ctx),
);
export type CriarClienteInput = z.infer<typeof CriarClienteInput>;

export const AtualizarClienteInput = ClienteBase.partial()
  .extend({ ativa: z.boolean().optional() })
  .superRefine((v, ctx) => conferirCamposFiscais(v, ctx));
export type AtualizarClienteInput = z.infer<typeof AtualizarClienteInput>;
