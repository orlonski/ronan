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
export const AtualizarMinhaEmpresaInput = z.object({
  // Exigir a FOTO do comprovante no lançamento. Não confundir com
  // Material.exigeTicket, que é o NÚMERO do ticket.
  exigeFotoViagem: z.boolean().optional(),
  exigeFotoAbastecimento: z.boolean().optional(),
});
export type AtualizarMinhaEmpresaInput = z.infer<typeof AtualizarMinhaEmpresaInput>;
