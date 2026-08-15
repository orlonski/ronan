import { BadRequestException } from "@nestjs/common";
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
  medicao: "PESO" | "PERIODO";
  exigeMaterial: boolean;
  exigeTicket: boolean;
  exigeLocalDescarga: boolean;
  exigeKm: boolean;
};

/**
 * O comportamento de sempre: frete medido em tonelada, tudo obrigatório.
 *
 * É pra onde caem app antigo (não manda tipoServicoId) e conta que ainda não
 * tem modo cadastrado. Mudar estes valores muda o sistema inteiro pra quem
 * nunca ouviu falar de diária — não mexer sem querer exatamente isso.
 */
export const MODO_CLASSICO: ModoServico = {
  id: null,
  medicao: "PESO",
  exigeMaterial: true,
  exigeTicket: true,
  exigeLocalDescarga: true,
  exigeKm: true,
};

/** Uma diária mais longa que isso é quase certamente data digitada errada. */
const MAX_DURACAO_MINUTOS = 30 * 24 * 60;

export async function resolverModoServico(
  prisma: PrismaService,
  tipoServicoId?: string | null,
): Promise<ModoServico> {
  const select = {
    id: true,
    medicao: true,
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
    if (!tipo) throw new ItemInexistenteException("tipoServicoId");
    return tipo;
  }

  // Sem tipo explícito: herda o padrão da conta. Conta sem padrão (base antiga
  // que não passou pelo backfill) cai no clássico — nunca num erro.
  const padrao = await prisma.tipoServico.findFirst({ where: { padrao: true }, select });
  return padrao ?? MODO_CLASSICO;
}

/**
 * O que gravar nas colunas de período, validando o que o motorista mandou.
 *
 * Erros aqui são 4xx de propósito: 500 num endpoint do motorista trava o outbox
 * em loop, enquanto 4xx manda o item pra tela de Pendentes com o texto certo.
 */
export function resolverPeriodo(
  modo: ModoServico,
  input: { entradaEm?: Date; saidaEm?: Date },
): {
  entradaEm: Date | null;
  saidaEm: Date | null;
  duracaoMinutos: number | null;
  aguardandoSaida: boolean;
} {
  // Medição por peso ignora entrada/saída mesmo que o app mande por engano —
  // assim um payload torto nunca cria viagem meio-diária, meio-frete.
  if (modo.medicao !== "PERIODO") {
    return { entradaEm: null, saidaEm: null, duracaoMinutos: null, aguardandoSaida: false };
  }

  const { entradaEm, saidaEm } = input;
  if (!entradaEm) {
    throw new BadRequestException("Marque a hora que o caminhão entrou.");
  }
  // Sem saída = diária ainda aberta. É estado normal, não erro: o motorista
  // marca a entrada de manhã e encerra quando sair (status AGUARDANDO_SAIDA).
  if (!saidaEm) {
    return { entradaEm, saidaEm: null, duracaoMinutos: null, aguardandoSaida: true };
  }

  const minutos = Math.round((saidaEm.getTime() - entradaEm.getTime()) / 60000);
  if (minutos <= 0) {
    // Vale pra virada da noite também: entrada e saída são instantes completos,
    // então 22h→06h do dia seguinte já dá positivo. Negativo aqui é engano.
    throw new BadRequestException("A hora de saída precisa ser depois da hora de entrada.");
  }
  if (minutos > MAX_DURACAO_MINUTOS) {
    throw new BadRequestException("Esse período passa de 30 dias — confira a data de entrada e saída.");
  }
  return { entradaEm, saidaEm, duracaoMinutos: minutos, aguardandoSaida: false };
}
