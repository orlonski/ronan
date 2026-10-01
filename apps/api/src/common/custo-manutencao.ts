/**
 * Para onde vai o dinheiro da manutenção: por mês, por caminhão, pelo que mais
 * se conserta e por oficina. Ideia da Cobli (o "dashboard de manutenção" deles).
 *
 * A divisão que importa pro dono não são os cinco tipos do cadastro, são dois:
 *   PROGRAMADA — preventiva, pneu, outro: o gasto que se planeja.
 *   QUEBRA     — corretiva e sinistro: o que pegou de surpresa, e que costuma
 *                vir junto com caminhão parado.
 * Frota com quebra crescendo é frota com preventiva atrasada.
 *
 * Função pura: o service busca, isto agrupa. Valores em number com 2 casas —
 * é painel de leitura, não fechamento de caixa.
 */

export type ManutencaoParaCusto = {
  id: string;
  veiculoId: string;
  tipo: string;
  concluidaEm: Date;
  /** Null = concluída sem valor. Contada à parte, nunca como zero. */
  valorTotal: number | null;
  descricao: string;
  fornecedorNome: string | null;
  /** Quando o conserto zerou um plano, o nome do plano é o nome do serviço. */
  planoDescricao: string | null;
};

export type VeiculoParaCusto = { id: string; placa: string; modelo: string | null };

const QUEBRA = new Set(["CORRETIVA", "SINISTRO"]);
export const ehQuebra = (tipo: string) => QUEBRA.has(tipo);

const r2 = (n: number) => Math.round(n * 100) / 100;

/** "AAAA-MM" do instante, no calendário de Brasília. */
export function mesSP(d: Date): string {
  const s = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
  }).format(d);
  return s.slice(0, 7);
}

/** Todos os meses entre dois "AAAA-MM", inclusive — mês sem gasto aparece como zero. */
export function mesesEntre(de: string, ate: string): string[] {
  const [a0, m0] = de.split("-").map(Number) as [number, number];
  const [a1, m1] = ate.split("-").map(Number) as [number, number];
  const out: string[] = [];
  for (let a = a0, m = m0; a < a1 || (a === a1 && m <= m1); m === 12 ? (a++, (m = 1)) : m++) {
    out.push(`${a}-${String(m).padStart(2, "0")}`);
    if (out.length > 60) break;
  }
  return out;
}

/**
 * Chave do serviço: "Troca de óleo", "troca de oleo " e "TROCA DE ÓLEO" são o
 * mesmo conserto digitado por três pessoas.
 */
export function chaveServico(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export type ResumoCustoManutencao = {
  totais: {
    gasto: number;
    consertos: number;
    semValor: number;
    mediaMes: number;
    /** % do gasto que foi quebra (corretiva + sinistro). Null sem gasto. */
    quebraPct: number | null;
    kmRodado: number;
    /** R$ de manutenção por km rodado. Null sem km. */
    porKm: number | null;
  };
  porMes: { mes: string; programada: number; quebra: number; total: number; consertos: number }[];
  porCaminhao: {
    veiculoId: string;
    placa: string;
    modelo: string | null;
    gasto: number;
    consertos: number;
    quebraPct: number | null;
    kmRodado: number;
    porKm: number | null;
  }[];
  porServico: { nome: string; vezes: number; gasto: number }[];
  porOficina: { nome: string; consertos: number; gasto: number }[];
};

/** Quanto a escrita parece revisada: tem maiúscula, tem acento. */
function capricho(s: string): number {
  return (s !== s.toLowerCase() ? 2 : 0) + (s !== s.normalize("NFD").replace(/[\u0300-\u036f]/g, "") ? 1 : 0);
}

const SEM_OFICINA = "Oficina não informada";
const TOP = 10;

export function resumirCustoManutencao(args: {
  manutencoes: ManutencaoParaCusto[];
  veiculos: VeiculoParaCusto[];
  kmPorVeiculo: Map<string, number>;
  /** "AAAA-MM" de início e fim do período. */
  mesDe: string;
  mesAte: string;
}): ResumoCustoManutencao {
  const meses = mesesEntre(args.mesDe, args.mesAte);
  const porMes = new Map(meses.map((m) => [m, { mes: m, programada: 0, quebra: 0, total: 0, consertos: 0 }]));
  const caminhoes = new Map<string, { gasto: number; quebra: number; consertos: number }>();
  const servicos = new Map<string, { nomes: Map<string, number>; vezes: number; gasto: number }>();
  const oficinas = new Map<string, { consertos: number; gasto: number }>();

  let gasto = 0;
  let quebra = 0;
  let semValor = 0;

  for (const m of args.manutencoes) {
    const valor = m.valorTotal ?? 0;
    if (m.valorTotal == null) semValor++;
    const q = ehQuebra(m.tipo);
    gasto += valor;
    if (q) quebra += valor;

    const linhaMes = porMes.get(mesSP(m.concluidaEm));
    if (linhaMes) {
      linhaMes[q ? "quebra" : "programada"] += valor;
      linhaMes.total += valor;
      linhaMes.consertos++;
    }

    const c = caminhoes.get(m.veiculoId) ?? { gasto: 0, quebra: 0, consertos: 0 };
    c.gasto += valor;
    if (q) c.quebra += valor;
    c.consertos++;
    caminhoes.set(m.veiculoId, c);

    const nome = (m.planoDescricao ?? m.descricao).trim();
    const chave = chaveServico(nome);
    if (chave) {
      const s = servicos.get(chave) ?? { nomes: new Map(), vezes: 0, gasto: 0 };
      s.nomes.set(nome, (s.nomes.get(nome) ?? 0) + 1);
      s.vezes++;
      s.gasto += valor;
      servicos.set(chave, s);
    }

    const of = m.fornecedorNome?.trim() || SEM_OFICINA;
    const o = oficinas.get(of) ?? { consertos: 0, gasto: 0 };
    o.consertos++;
    o.gasto += valor;
    oficinas.set(of, o);
  }

  const kmTotal = [...args.kmPorVeiculo.values()].reduce((s, k) => s + k, 0);
  const veiculoPorId = new Map(args.veiculos.map((v) => [v.id, v]));

  return {
    totais: {
      gasto: r2(gasto),
      consertos: args.manutencoes.length,
      semValor,
      mediaMes: r2(gasto / Math.max(1, meses.length)),
      quebraPct: gasto > 0 ? Math.round((quebra / gasto) * 1000) / 10 : null,
      kmRodado: Math.round(kmTotal),
      porKm: kmTotal > 0 ? r2(gasto / kmTotal) : null,
    },
    porMes: meses.map((m) => {
      const l = porMes.get(m)!;
      return { ...l, programada: r2(l.programada), quebra: r2(l.quebra), total: r2(l.total) };
    }),
    porCaminhao: [...caminhoes.entries()]
      .map(([veiculoId, c]) => {
        const v = veiculoPorId.get(veiculoId);
        const km = args.kmPorVeiculo.get(veiculoId) ?? 0;
        return {
          veiculoId,
          placa: v?.placa ?? "—",
          modelo: v?.modelo ?? null,
          gasto: r2(c.gasto),
          consertos: c.consertos,
          quebraPct: c.gasto > 0 ? Math.round((c.quebra / c.gasto) * 1000) / 10 : null,
          kmRodado: Math.round(km),
          porKm: km > 0 ? r2(c.gasto / km) : null,
        };
      })
      .sort((a, b) => b.gasto - a.gasto || b.consertos - a.consertos),
    porServico: [...servicos.values()]
      .map((s) => ({
        // O jeito mais comum de escrever vira o rótulo; no empate, o mais
        // "caprichado" (maiúscula e acento) — "Troca de óleo", não "troca de oleo".
        nome: [...s.nomes.entries()].sort((a, b) => b[1] - a[1] || capricho(b[0]) - capricho(a[0]))[0]![0],
        vezes: s.vezes,
        gasto: r2(s.gasto),
      }))
      .sort((a, b) => b.vezes - a.vezes || b.gasto - a.gasto)
      .slice(0, TOP),
    porOficina: [...oficinas.entries()]
      .map(([nome, o]) => ({ nome, consertos: o.consertos, gasto: r2(o.gasto) }))
      .sort((a, b) => b.gasto - a.gasto)
      .slice(0, TOP),
  };
}
