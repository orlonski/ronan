import { Prisma } from "@prisma/client";
import { valorDaEstadia } from "./torre";

/**
 * Estadia que vira cobrança. A torre já calcula o tempo parado com valor/hora
 * (TipoEventoViagem.geraCobranca + valorHora), mas o número nunca chegava à
 * fatura: a transportadora esperava 3 horas na obra e não cobrava. Os
 * concorrentes de granel (Trux, Tread) cobram "demurrage" automático.
 *
 * Só ENCERRADA entra: estadia aberta ainda está correndo, e cobrar um valor
 * que muda depois de emitido é a fatura mudando sozinha. E a mesma parada
 * nunca entra em duas faturas vivas.
 */

export type EventoParaEstadia = {
  id: string;
  viagemId: string;
  tipoNome: string;
  geraCobranca: boolean;
  valorHora: Prisma.Decimal | string | number | null;
  iniciouEm: Date | null;
  terminouEm: Date | null;
  /** Já é linha de uma fatura que não foi cancelada. */
  jaFaturado: boolean;
};

export type EstadiaCobravel = {
  eventoId: string;
  viagemId: string;
  tipoNome: string;
  horas: number;
  horasCobradas: number;
  valorHora: string;
  valor: string;
};

export function estadiasCobraveis(eventos: EventoParaEstadia[]): EstadiaCobravel[] {
  const out: EstadiaCobravel[] = [];
  for (const e of eventos) {
    if (!e.geraCobranca || e.jaFaturado || !e.iniciouEm || !e.terminouEm || e.valorHora == null) continue;
    const est = valorDaEstadia({ iniciouEm: e.iniciouEm, terminouEm: e.terminouEm, valorHora: e.valorHora });
    if (!est || est.horasCobradas <= 0 || new Prisma.Decimal(est.valor).lte(0)) continue;
    out.push({
      eventoId: e.id,
      viagemId: e.viagemId,
      tipoNome: e.tipoNome,
      horas: est.horas,
      horasCobradas: est.horasCobradas,
      valorHora: new Prisma.Decimal(e.valorHora).toFixed(2),
      valor: new Prisma.Decimal(est.valor).toFixed(2),
    });
  }
  return out;
}
