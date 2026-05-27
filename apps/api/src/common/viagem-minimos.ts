import { Prisma } from "@prisma/client";

// Regra de negócio: o motorista lança o real, mas se o cliente tem um piso
// (toneladasMinimas/kmMinimos) e o real ficou abaixo, contabilizamos pelo
// piso em telas, agregados, fechamentos e XLSX. O real nunca é sobrescrito
// em Viagem.toneladas/km.

type DecimalLike = Prisma.Decimal | string | number;

export type ViagemBruta = {
  toneladas: DecimalLike;
  km: DecimalLike;
};

export type ClienteMinimos = {
  toneladasMinimas: DecimalLike | null;
  kmMinimos: DecimalLike | null;
};

// Nomes evitam colidir com Viagem.kmReal (GPS tracking) — esse "kmInformado"
// é o que o motorista lançou (Viagem.km), antes de aplicar o mínimo.
export type CamposMinimos = {
  toneladasInformada: string;
  toneladasEfetiva: string;
  toneladasAjustada: boolean;
  kmInformado: string;
  kmEfetivo: string;
  kmAjustada: boolean;
};

function dec(v: DecimalLike): Prisma.Decimal {
  return v instanceof Prisma.Decimal ? v : new Prisma.Decimal(v);
}

export function aplicarMinimosCliente(
  viagem: ViagemBruta,
  cliente: ClienteMinimos,
): CamposMinimos {
  const tonReal = dec(viagem.toneladas);
  const kmReal = dec(viagem.km);

  const tonMin = cliente.toneladasMinimas != null ? dec(cliente.toneladasMinimas) : null;
  const kmMin = cliente.kmMinimos != null ? dec(cliente.kmMinimos) : null;

  const tonAjustada = tonMin !== null && tonReal.lt(tonMin);
  const kmAjustada = kmMin !== null && kmReal.lt(kmMin);

  const tonEfetivo = tonAjustada ? (tonMin as Prisma.Decimal) : tonReal;
  const kmEfetivo = kmAjustada ? (kmMin as Prisma.Decimal) : kmReal;

  return {
    toneladasInformada: tonReal.toFixed(3),
    toneladasEfetiva: tonEfetivo.toFixed(3),
    toneladasAjustada: tonAjustada,
    kmInformado: kmReal.toFixed(2),
    kmEfetivo: kmEfetivo.toFixed(2),
    kmAjustada,
  };
}

export function serializarViagemComMinimos<
  T extends ViagemBruta & { cliente: ClienteMinimos },
>(viagem: T): T & CamposMinimos {
  return { ...viagem, ...aplicarMinimosCliente(viagem, viagem.cliente) };
}
