import { MotivoDivergencia } from "@prisma/client";
import { camposFaltandoPeloModo, type CampoExigidoPeloModo } from "@ronan/shared-types";
import type { PrismaService } from "../prisma/prisma.service";
import { ItemInexistenteException } from "./item-inexistente";

/**
 * Modo de serviço RESOLVIDO — o que vale pra ESTA viagem.
 *
 * Toda regra de "o que o lançamento exige" passa por aqui, do jeito que todo
 * cálculo de efetivo passa por viagem-minimos.ts. O app é só UI: ele esconde os
 * campos que o modo não pede, mas quem decide é este arquivo.
 */
export type ModoServico = {
  id: string | null;
  exigeMaterial: boolean;
  exigeTicket: boolean;
  exigeLocalDescarga: boolean;
  exigeKm: boolean;
};

/**
 * O comportamento de sempre: frete medido em tonelada, tudo obrigatório.
 *
 * É pra onde caem app antigo (não manda tipoServicoId) e conta que ainda não
 * tem modo cadastrado. Mudar estes valores muda o sistema inteiro — não mexer
 * sem querer exatamente isso.
 */
export const MODO_CLASSICO: ModoServico = {
  id: null,
  exigeMaterial: true,
  exigeTicket: true,
  exigeLocalDescarga: true,
  exigeKm: true,
};

/**
 * Coletor de divergências (só o que esta função usa). Opcional: chamadores do
 * painel não carimbam nada — lá o admin tem como corrigir na hora.
 */
type ColetorDivergencia = {
  add: (motivo: "CADASTRO_TIPO_SERVICO_SUMIU", dados?: { tipoServicoId: string }) => unknown;
};

export async function resolverModoServico(
  prisma: PrismaService,
  tipoServicoId?: string | null,
  divs?: ColetorDivergencia,
): Promise<ModoServico> {
  const select = {
    id: true,
    exigeMaterial: true,
    exigeTicket: true,
    exigeLocalDescarga: true,
    exigeKm: true,
  } as const;

  if (tipoServicoId) {
    // `ativo` NÃO entra no filtro de propósito: um item preso no outbox pode
    // chegar dias depois de o admin ter desativado o modo, e recusar aqui faria
    // o motorista ter que reeditar um lançamento que estava certo quando foi
    // feito. Desativar esconde do seletor; não invalida o que já saiu.
    const tipo = await prisma.tipoServico.findUnique({ where: { id: tipoServicoId }, select });
    if (tipo) return tipo;
    // Tipo apagado do cadastro. Com coletor (lançamento do motorista) o
    // lançamento NUNCA é recusado: cai no padrão da conta e sai carimbado pro
    // conferente dizer como a viagem deve ser medida. Sem coletor (painel),
    // segue recusando — lá quem está na tela consegue corrigir na hora.
    if (!divs) throw new ItemInexistenteException("tipoServicoId");
    divs.add("CADASTRO_TIPO_SERVICO_SUMIU", { tipoServicoId });
  }

  // Sem tipo explícito: herda o padrão da conta. Conta sem padrão (base antiga
  // que não passou pelo backfill) cai no clássico — nunca num erro.
  const padrao = await prisma.tipoServico.findFirst({ where: { padrao: true }, select });
  return padrao ?? MODO_CLASSICO;
}

const MOTIVO_DA_FALTA: Record<CampoExigidoPeloModo, MotivoDivergencia> = {
  toneladas: MotivoDivergencia.FALTA_TONELADAS,
  materialId: MotivoDivergencia.FALTA_MATERIAL,
  km: MotivoDivergencia.FALTA_KM,
  localDescargaId: MotivoDivergencia.FALTA_LOCAL_DESCARGA,
};

/**
 * Carimba o que falta no lançamento do motorista, pela régua do modo.
 *
 * É a mesma função (`camposFaltandoPeloModo`, shared-types) que o app roda
 * antes de enfileirar — o servidor não pode cobrar um campo que o app escondeu.
 * Nunca recusa: o lançamento entra e a falta vai pro painel.
 */
export function carimbarFaltasDoModo(
  divs: { add: (motivo: MotivoDivergencia) => unknown },
  val: Parameters<typeof camposFaltandoPeloModo>[0],
  modo: Pick<ModoServico, "exigeMaterial" | "exigeKm" | "exigeLocalDescarga">,
): void {
  for (const f of camposFaltandoPeloModo(val, modo)) divs.add(MOTIVO_DA_FALTA[f.campo]);
}
