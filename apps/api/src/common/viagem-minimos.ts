import { Prisma } from "@prisma/client";

// Regra de negócio: o motorista lança o real, mas se há uma regra de mínimo
// (RegraMinimo, por empresa+material+faixa de km) e o real ficou abaixo,
// contabilizamos pelo mínimo em telas, agregados, fechamentos e XLSX. O real
// nunca é sobrescrito em Viagem.toneladas/km. (O mínimo antigo por cliente foi
// aposentado — tudo passa pela RegraMinimo.)

type DecimalLike = Prisma.Decimal | string | number;

// toneladas/km são nullable no banco por causa do lifecycle (viagem
// EM_ANDAMENTO ainda não tem esses valores). Essas viagens são filtradas antes
// de chegar aqui; coagimos null→0 por segurança de tipos.
export type ViagemBruta = {
  toneladas: DecimalLike | null;
  km: DecimalLike | null;
};

// Regra dinâmica de mínimo por empresa + material + faixa de km (tabela
// regras_minimo). materialId null = qualquer material. kmFaixaDe inclusivo,
// kmFaixaAte exclusivo (null = sem teto).
export type RegraMinimoRow = {
  empresaId: string;
  materialId: string | null;
  kmFaixaDe: DecimalLike;
  kmFaixaAte: DecimalLike | null;
  kmMinimo: DecimalLike | null;
  toneladasMinimo: DecimalLike | null;
  ativo?: boolean;
};

export type MinimoOverride = {
  kmMinimo: Prisma.Decimal | null;
  toneladasMinimo: Prisma.Decimal | null;
};

/**
 * Acha a regra que casa pra (empresa, material, km rodado) e devolve os mínimos
 * dela. Material-específico vence "qualquer" (materialId null); entre iguais, a
 * faixa mais estreita (maior kmFaixaDe) vence. Retorna null se nada casar.
 */
export function resolverRegraMinimo(
  regras: RegraMinimoRow[],
  empresaId: string,
  materialId: string | null,
  kmReal: DecimalLike,
): MinimoOverride | null {
  const km = dec(kmReal);
  const candidatas = regras.filter(
    (r) =>
      r.ativo !== false &&
      r.empresaId === empresaId &&
      (r.materialId == null || r.materialId === materialId) &&
      dec(r.kmFaixaDe).lte(km) &&
      (r.kmFaixaAte == null || km.lt(dec(r.kmFaixaAte))),
  );
  if (candidatas.length === 0) return null;
  candidatas.sort((a, b) => {
    const espA = a.materialId ? 1 : 0;
    const espB = b.materialId ? 1 : 0;
    if (espA !== espB) return espB - espA; // material específico primeiro
    return Number(b.kmFaixaDe) - Number(a.kmFaixaDe); // faixa mais estreita
  });
  const r = candidatas[0]!;
  return {
    kmMinimo: r.kmMinimo != null ? dec(r.kmMinimo) : null,
    toneladasMinimo: r.toneladasMinimo != null ? dec(r.toneladasMinimo) : null,
  };
}

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

export function aplicarMinimos(
  viagem: ViagemBruta,
  // Mínimo resolvido da RegraMinimo (empresa+material+faixa). Sem regra que
  // case, não há mínimo — vale o real.
  override?: MinimoOverride,
): CamposMinimos {
  const tonReal = dec(viagem.toneladas ?? 0);
  const kmReal = dec(viagem.km ?? 0);

  const tonMin = override?.toneladasMinimo ?? null;
  const kmMin = override?.kmMinimo ?? null;

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
  T extends ViagemBruta & {
    cliente?: { empresaId?: string | null } | null;
    material?: { id: string } | null;
  },
>(viagem: T, regras?: RegraMinimoRow[]): T & CamposMinimos {
  let override: MinimoOverride | undefined;
  const empresaId = viagem.cliente?.empresaId;
  const materialId = viagem.material?.id;
  if (regras && regras.length > 0 && empresaId && materialId) {
    override = resolverRegraMinimo(regras, empresaId, materialId, viagem.km ?? 0) ?? undefined;
  }
  return { ...viagem, ...aplicarMinimos(viagem, override) };
}
