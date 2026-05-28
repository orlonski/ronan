/**
 * Compat on-read pra renames feitos no backend que podem ter dados em cache
 * local (IndexedDB) no shape antigo. Sem essas normalizações, motorista que
 * voltou online depois de atualização vê tela quebrada.
 */

export function normalizarViagem<T extends { cliente?: unknown; obra?: unknown }>(v: T): T {
  if (!v) return v;
  const anyV = v as Record<string, unknown>;
  if (!anyV.cliente && anyV.obra) {
    const obra = anyV.obra as Record<string, unknown>;
    if (obra && obra.empresaCliente && !obra.empresa) {
      obra.empresa = obra.empresaCliente;
    }
    anyV.cliente = obra;
  }
  return v;
}

export function normalizarCatalogos<
  T extends { clientes?: unknown; obras?: unknown; locais?: unknown },
>(c: T): T {
  if (!c) return c;
  const anyC = c as Record<string, unknown>;
  if (!anyC.clientes && Array.isArray(anyC.obras)) {
    anyC.clientes = (anyC.obras as Array<Record<string, unknown>>).map((o) => {
      if (o && o.empresaCliente && !o.empresa) o.empresa = o.empresaCliente;
      return o;
    });
  }
  if (!Array.isArray(anyC.empresas)) anyC.empresas = [];
  if (Array.isArray(anyC.locais)) {
    anyC.locais = (anyC.locais as Array<Record<string, unknown>>).map(normalizarLocal);
  }
  return c;
}

export function normalizarLocal<T>(l: T): T {
  if (!l) return l;
  const anyL = l as unknown as Record<string, unknown>;
  if (Array.isArray(anyL.clienteIds)) return l;
  const legacy = anyL.clienteId as string | null | undefined;
  anyL.clienteIds = legacy ? [legacy] : [];
  return l;
}

export function normalizarAbastecimento<T extends { empresa?: unknown }>(a: T): T {
  if (!a) return a;
  const anyA = a as Record<string, unknown>;
  if (!("empresa" in anyA)) anyA.empresa = null;
  return a;
}

export function normalizarMe<T extends Record<string, unknown>>(m: T): T {
  if (!m) return m;
  const anyM = m as Record<string, unknown>;
  if (typeof anyM.podeLancarViagem !== "boolean") anyM.podeLancarViagem = true;
  if (typeof anyM.podeIniciarViagem !== "boolean") anyM.podeIniciarViagem = true;
  if (typeof anyM.podeLancarPedagio !== "boolean") anyM.podeLancarPedagio = true;
  if (typeof anyM.podeLancarAbastecimento !== "boolean") anyM.podeLancarAbastecimento = true;
  if (typeof anyM.podeUsarOcrTicket !== "boolean") anyM.podeUsarOcrTicket = true;
  return m;
}
