import { centavos, normalizarPlaca } from "./normalizacao";

/**
 * Leitor da fatura mensal do Sem Parar, a partir do TEXTO que o `pdf-parse`
 * devolve (o mesmo que `fechamentos/parsers/pdf-parser.ts` usa).
 *
 * ⚠️ O contrato é NUNCA ERRAR CALADO (04-qa B1). Um arquivo de outra
 * operadora lia "0 placas, 0 não lidas, sem erro" e entrava como importado; um
 * vale sem o D/C sumia e a regra seguinte acusava o embarcador de não ter
 * pago. Por isso o leitor devolve as 6 checagens e só diz LIDO quando todas
 * passam:
 *
 *  1. cabeçalho: "SEM PARAR", nº da fatura, período e CNPJ;
 *  2. registros com data+hora no texto cru = passagens + linhas de vale lidas;
 *  3. placas do Resumo = blocos de placa, cada uma uma vez;
 *  4. por placa: soma = "Total de Pedágio", líquido do vale = "Total de Vale"
 *     (a diferença de quantidade pro Resumo é DITA, não engolida);
 *  5. Σ uso do Resumo = "Passagens" da nota; uso + planos + outras = total;
 *  6. linha que não fecha registro vai pra `naoLidas`, nunca é sobrescrita.
 *
 * FALHOU (nada se grava): cabeçalho, zero placas, placas que não batem, zero
 * linhas. LIDO_COM_DIVERGENCIA (grava e mostra a linha crua): 2, 4, 5 ou 6.
 */

export type StatusLeitura = "LIDO" | "LIDO_COM_DIVERGENCIA" | "FALHOU";

export type LinhaPassagemLida = {
  linha: number;
  original: string;
  data: string; // dd/mm/aa como veio (aceita aaaa)
  hora: string;
  concessionaria: string | null;
  pracaTexto: string;
  rodovia: string;
  kmMetros: number;
  sentido: string;
  cidade: string;
  categoria: number;
  valorCent: number;
  dc: "D" | "C";
};

export type LinhaValeLida = LinhaPassagemLida & {
  embarcadorTexto: string;
  numeroViagem: string;
};

export type BlocoPlaca = {
  placa: string;
  plano: string;
  passagens: LinhaPassagemLida[];
  vales: LinhaValeLida[];
  outras: { data: string; descricao: string; valorCent: number; dc: "D" | "C" }[];
  totais: { pedagioCent?: number; valeCent?: number; outrasCent?: number };
};

export type ResumoVeiculoLido = { placa: string; planoCent: number; usoCent: number; qtd: number; totalCent: number };

export type Checagem = { n: 1 | 2 | 3 | 4 | 5 | 6; nome: string; ok: boolean; detalhe: string };

export type NaoLida = { linha: number; texto: string; motivo: string };

export type LeituraFatura = {
  status: StatusLeitura;
  motivo: string | null;
  cabecalho: {
    semParar: boolean;
    numeroFatura: string | null;
    numeroNotaFiscal: string | null;
    codigoCliente: string | null;
    /** Só dígitos, o do CLIENTE (não o "CNPJ/MF" da operadora). */
    cnpj: string | null;
    nome: string | null;
    /** AAAA-MM-DD */
    periodoDe: string | null;
    periodoAte: string | null;
    emitidoEm: string | null;
  };
  recargas: { data: string; valorCent: number }[];
  resumo: ResumoVeiculoLido[];
  totalResumo: ResumoVeiculoLido | null;
  /** Linhas do "Plano Contratado" por placa: o que a fatura cobra que não é pedágio. */
  planos: { placa: string; descricao: string; valorCent: number }[];
  placas: BlocoPlaca[];
  nf: {
    planoQtd: number | null;
    planoCent: number | null;
    outrasQtd: number | null;
    outrasCent: number | null;
    passagensQtd: number | null;
    passagensCent: number | null;
    totalCent: number | null;
  };
  naoLidas: NaoLida[];
  registrosCrus: number;
  checagens: Checagem[];
};

const PLACA = String.raw`[A-Z]{3}-?\d[A-Z0-9]\d{2}`;
const DATA = String.raw`\d{2}\/\d{2}\/\d{2}(?:\d{2})?`;
const VALOR = String.raw`[\d.]+,\d{2}`;
const RE_PLACA_BLOCO = new RegExp(`^(${PLACA}) - (.+)$`);
const RE_PRACA = /([A-Z]{2}\d{3}), KM(\d+)\+(\d{3}), (NORTE|SUL|LESTE|OESTE), (.+)$/;
const RE_PASSAGEM = new RegExp(
  `^(${DATA}) (\\d{2}:\\d{2}:\\d{2}) (.+?) ([A-Z]{2}\\d{3}, KM\\d+\\+\\d{3}, (?:NORTE|SUL|LESTE|OESTE), .+?) (\\d{1,2}) (${VALOR}) ([DC])$`,
);
const RE_FIM_VALE = new RegExp(`(\\d{1,2}) (\\d{6,}) (${VALOR}) ([DC])$`);
const RE_REGISTRO = new RegExp(`^${DATA} \\d{2}:\\d{2}:\\d{2}(?: |$)`);
const RE_RESUMO = new RegExp(`^(${PLACA}|Total) (${VALOR}) D (${VALOR}) D (\\d+) (${VALOR}) D$`);
const RE_PLANO = new RegExp(
  `^(?:(${PLACA}) PLANO CONTRATADO )?(\\d{2}\\/\\d{2}\\/\\d{4}) a (\\d{2}\\/\\d{2}\\/\\d{4}) (.+) (${VALOR}) ([DC])$`,
);

/** Concessionárias conhecidas: separam "CONCESSIONÁRIA EMBARCADOR" na linha D do vale. */
const CONCESSIONARIAS_CONHECIDAS = ["NOVA ROTA DO OESTE", "VIA BRASIL MT 246", "ECOVIAS DO ARAGUAIA"];

function anoDe(aa: string): number {
  const n = Number(aa);
  return n < 100 ? 2000 + n : n;
}

const iso = (ano: number, mes: number, dia: number) =>
  `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;

export function lerFaturaSemParar(texto: string): LeituraFatura {
  const linhas = texto
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const corrido = linhas.join(" ");

  const out: LeituraFatura = {
    status: "FALHOU",
    motivo: null,
    cabecalho: {
      semParar: linhas.slice(0, 40).some((l) => /SEM PARAR/i.test(l)),
      numeroFatura: /Nº da Fatura:\s*(\d+)/i.exec(corrido)?.[1] ?? null,
      numeroNotaFiscal: /Nº da Nota Fiscal:\s*(\d+)/i.exec(corrido)?.[1] ?? null,
      codigoCliente: /C[óo]digo de Cliente:\s*(\d+)/i.exec(corrido)?.[1] ?? null,
      cnpj: null,
      nome: null,
      periodoDe: null,
      periodoAte: null,
      emitidoEm: null,
    },
    recargas: [],
    resumo: [],
    totalResumo: null,
    planos: [],
    placas: [],
    nf: {
      planoQtd: null,
      planoCent: null,
      outrasQtd: null,
      outrasCent: null,
      passagensQtd: null,
      passagensCent: null,
      totalCent: null,
    },
    naoLidas: [],
    registrosCrus: 0,
    checagens: [],
  };

  // O CNPJ do CLIENTE começa a linha com "CNPJ:"; o da operadora é "CNPJ/MF:".
  for (const l of linhas) {
    const m = /^CNPJ:\s*([\d./-]{14,18})/.exec(l);
    if (m) {
      out.cabecalho.cnpj = m[1]!.replace(/\D/g, "");
      break;
    }
  }
  out.cabecalho.nome = linhas.map((l) => /^Nome:\s*(.+)$/.exec(l)?.[1]).find(Boolean)?.trim() ?? null;

  const emissao = /Data de Emiss[ãa]o:\s*(\d{2})\/(\d{2})\/(\d{2,4})/.exec(corrido);
  const periodo = /per[íi]odo de (\d{2})\/(\d{2}) a (\d{2})\/(\d{2})/i.exec(corrido);
  if (emissao) out.cabecalho.emitidoEm = iso(anoDe(emissao[3]!), Number(emissao[2]), Number(emissao[1]));
  if (periodo) {
    const [dDe, mDe, dAte, mAte] = [periodo[1], periodo[2], periodo[3], periodo[4]].map(Number) as [
      number,
      number,
      number,
      number,
    ];
    // O período não traz ano: vem da emissão (fatura de dezembro emitida em janeiro).
    const anoEmissao = emissao ? anoDe(emissao[3]!) : null;
    const mesEmissao = emissao ? Number(emissao[2]) : null;
    if (anoEmissao != null && mesEmissao != null) {
      const anoAte = mAte <= mesEmissao ? anoEmissao : anoEmissao - 1;
      const anoDe_ = mDe <= mAte ? anoAte : anoAte - 1;
      out.cabecalho.periodoDe = iso(anoDe_, mDe, dDe);
      out.cabecalho.periodoAte = iso(anoAte, mAte, dAte);
    }
  }

  let placa: string | null = null;
  let secao: string | null = null;
  let placaPlano: string | null = null;
  let buf: { linha: number; partes: string[] } | null = null;
  const vistosBloco = new Map<string, number>();
  const blocos = new Map<string, BlocoPlaca>();
  const bloco = (): BlocoPlaca | null => {
    if (!placa) return null;
    let b = blocos.get(placa);
    if (!b) {
      b = { placa, plano: "", passagens: [], vales: [], outras: [], totais: {} };
      blocos.set(placa, b);
    }
    return b;
  };
  const fecharValeAberto = (motivo: string) => {
    if (buf) out.naoLidas.push({ linha: buf.linha, texto: buf.partes.join(" "), motivo });
    buf = null;
  };
  const naoLida = (n: number, l: string, motivo: string) => out.naoLidas.push({ linha: n, texto: l, motivo });

  linhas.forEach((l, i) => {
    const n = i + 1;
    if (RE_REGISTRO.test(l)) out.registrosCrus++;
    // Quebra de página: rodapé, "n/7" e o código do cliente sozinho na linha.
    if (/^-- \d+ of \d+ --$/.test(l) || /^\d+\/\d+$/.test(l) || /^\d{5,12}$/.test(l)) return;
    let m: RegExpExecArray | null;

    if (l === "Recargas R$") return void (secao = "recargas");
    if (l === "Resumo por Veículo R$") return void (secao = "resumo");
    if (l === "Plano Contratado") return void (secao = "planos");
    if ((m = RE_PLACA_BLOCO.exec(l)) && !/PLANO CONTRATADO/.test(l)) {
      fecharValeAberto("linha de vale que não fechou antes do próximo bloco");
      placa = normalizarPlaca(m[1]!);
      vistosBloco.set(placa, (vistosBloco.get(placa) ?? 0) + 1);
      bloco()!.plano = m[2]!;
      secao = null;
      return;
    }
    if (/^Detalhamento das Passagens por Ped[áa]gios/.test(l)) return void (secao = "passagens");
    if (/^Detalhamento das Passagens Vale Ped[áa]gio/.test(l)) {
      fecharValeAberto("linha de vale que não fechou");
      return void (secao = "vales");
    }
    if (/^Outras arrecada[çc][õo]es/.test(l) && !/^Total/.test(l)) {
      fecharValeAberto("linha de vale que não fechou antes de outras arrecadações");
      return void (secao = "outras");
    }
    if ((m = new RegExp(`^Total de Ped[áa]gio (${VALOR})(?: ([DC]))?$`).exec(l))) {
      const b = bloco();
      if (b) b.totais.pedagioCent = centavos(m[1]!) * (m[2] === "C" ? -1 : 1);
      return;
    }
    if ((m = new RegExp(`^Total de Vale Ped[áa]gio (${VALOR})(?: ([DC]))?$`).exec(l))) {
      fecharValeAberto("linha de vale que não fechou antes do total");
      const b = bloco();
      if (b) b.totais.valeCent = centavos(m[1]!) * (m[2] === "C" ? -1 : 1);
      secao = null;
      return;
    }
    if ((m = new RegExp(`^Total de outras arrecada[çc][õo]es (${VALOR})(?: ([DC]))?$`).exec(l))) {
      const b = bloco();
      if (b) b.totais.outrasCent = centavos(m[1]!) * (m[2] === "C" ? -1 : 1);
      secao = null;
      return;
    }
    if (/^Valores Tribut[áa]veis/.test(l)) {
      fecharValeAberto("linha de vale que não fechou antes da nota fiscal");
      secao = "nf";
      placa = null;
      return;
    }
    if ((m = new RegExp(`Total da Nota Fiscal (${VALOR}) D`).exec(l))) out.nf.totalCent = centavos(m[1]!);

    if (secao === "recargas" && (m = new RegExp(`^(${DATA}) VALOR RECARGA (${VALOR}) C$`).exec(l))) {
      out.recargas.push({ data: m[1]!, valorCent: centavos(m[2]!) });
      return;
    }
    if (secao === "resumo") {
      if ((m = RE_RESUMO.exec(l))) {
        const r = {
          placa: m[1] === "Total" ? "Total" : normalizarPlaca(m[1]!),
          planoCent: centavos(m[2]!),
          usoCent: centavos(m[3]!),
          qtd: Number(m[4]),
          totalCent: centavos(m[5]!),
        };
        if (r.placa === "Total") out.totalResumo = r;
        else out.resumo.push(r);
      } else if (new RegExp(`^${PLACA}\\b`).test(l) || /^Total\b/.test(l)) {
        naoLida(n, l, "linha do Resumo por Veículo num formato que não conheço");
      }
      return;
    }
    if (secao === "planos") {
      if ((m = RE_PLANO.exec(l))) {
        if (m[1]) placaPlano = normalizarPlaca(m[1]);
        if (placaPlano) {
          out.planos.push({
            placa: placaPlano,
            descricao: m[4]!.trim(),
            valorCent: centavos(m[5]!) * (m[6] === "C" ? -1 : 1),
          });
        }
      }
      return;
    }
    if (secao === "passagens" && new RegExp(`^${DATA} `).test(l)) {
      const b = bloco();
      m = RE_PASSAGEM.exec(l);
      const p = m ? RE_PRACA.exec(m[4]!) : null;
      if (!b || !m || !p) return void naoLida(n, l, "passagem num formato que não conheço");
      b.passagens.push({
        linha: n,
        original: l,
        data: m[1]!,
        hora: m[2]!,
        concessionaria: m[3]!.trim(),
        pracaTexto: m[4]!,
        rodovia: p[1]!,
        kmMetros: Number(p[2]) * 1000 + Number(p[3]),
        sentido: p[4]!,
        cidade: p[5]!.trim(),
        categoria: Number(m[5]),
        valorCent: centavos(m[6]!),
        dc: m[7] as "D" | "C",
      });
      return;
    }
    if (secao === "vales") {
      if (/^Data Hora/.test(l)) return;
      if (RE_REGISTRO.test(l)) {
        // Registro novo com o anterior aberto: o anterior NÃO fechou. Antes ele
        // era sobrescrito e sumia (04-qa B1, mutação "vale sem D/C").
        fecharValeAberto("linha de vale que não fechou (sem categoria, viagem, valor e D/C)");
        buf = { linha: n, partes: [l] };
      } else if (buf) {
        buf.partes.push(l);
      }
      if (buf && RE_FIM_VALE.test(l)) {
        const txt = buf.partes.join(" ");
        const f = RE_FIM_VALE.exec(txt)!;
        const inicio = new RegExp(`^(${DATA}) (\\d{2}:\\d{2}:\\d{2}) (.*)$`).exec(txt.replace(RE_FIM_VALE, "").trim());
        const meio = inicio?.[3] ?? "";
        const ip = meio.search(/[A-Z]{2}\d{3}, KM/);
        const praca = ip >= 0 ? meio.slice(ip).trim() : "";
        const p = RE_PRACA.exec(praca);
        const b = bloco();
        if (!inicio || ip < 0 || !p || !b) {
          naoLida(buf.linha, txt, "linha de vale num formato que não conheço");
        } else {
          b.vales.push({
            linha: buf.linha,
            original: txt,
            data: inicio[1]!,
            hora: inicio[2]!,
            concessionaria: null,
            embarcadorTexto: meio.slice(0, ip).trim(),
            pracaTexto: praca,
            rodovia: p[1]!,
            kmMetros: Number(p[2]) * 1000 + Number(p[3]),
            sentido: p[4]!,
            cidade: p[5]!.trim(),
            categoria: Number(f[1]),
            numeroViagem: f[2]!,
            valorCent: centavos(f[3]!),
            dc: f[4] as "D" | "C",
          });
        }
        buf = null;
      }
      return;
    }
    if (secao === "outras" && (m = new RegExp(`^(${DATA}) (.+) (${VALOR}) ([DC])$`).exec(l))) {
      bloco()?.outras.push({ data: m[1]!, descricao: m[2]!.trim(), valorCent: centavos(m[3]!), dc: m[4] as "D" | "C" });
      return;
    }
    if (secao === "nf" && (m = new RegExp(`^(Plano Contratado|Outras Taxas|Passagens) (\\d+) (${VALOR}) ([DC])$`).exec(l))) {
      const qtd = Number(m[2]);
      const v = centavos(m[3]!);
      if (m[1] === "Plano Contratado") Object.assign(out.nf, { planoQtd: qtd, planoCent: v });
      if (m[1] === "Outras Taxas") Object.assign(out.nf, { outrasQtd: qtd, outrasCent: v });
      if (m[1] === "Passagens") Object.assign(out.nf, { passagensQtd: qtd, passagensCent: v });
    }
  });
  fecharValeAberto("linha de vale que não fechou no fim do arquivo");

  // Vale: a linha D traz "CONCESSIONÁRIA EMBARCADOR"; a C, só o embarcador.
  const conhecidas = [
    ...new Set([...[...blocos.values()].flatMap((b) => b.passagens.map((p) => p.concessionaria!)), ...CONCESSIONARIAS_CONHECIDAS]),
  ].sort((a, b) => b.length - a.length);
  for (const b of blocos.values()) {
    for (const v of b.vales) {
      const c = conhecidas.find((k) => v.embarcadorTexto === k || v.embarcadorTexto.startsWith(`${k} `));
      v.concessionaria = c ?? null;
      if (c) v.embarcadorTexto = v.embarcadorTexto.slice(c.length).trim();
    }
  }
  out.placas = [...blocos.values()];

  return fecharChecagens(out, vistosBloco);
}

function fecharChecagens(out: LeituraFatura, vistosBloco: Map<string, number>): LeituraFatura {
  const brl = (c: number) => (c / 100).toFixed(2).replace(".", ",");
  const ch: Checagem[] = [];
  const c = out.cabecalho;

  const faltaCab = [
    !c.semParar && "o nome SEM PARAR",
    !c.numeroFatura && "o nº da fatura",
    !c.periodoDe && "o período",
    !c.cnpj && "o CNPJ",
  ].filter(Boolean) as string[];
  ch.push({
    n: 1,
    nome: "Cabeçalho do Sem Parar",
    ok: faltaCab.length === 0,
    detalhe: faltaCab.length ? `Não achei ${faltaCab.join(", ")}.` : `Fatura ${c.numeroFatura}, ${c.periodoDe} a ${c.periodoAte}.`,
  });

  const lidas = out.placas.reduce((s, b) => s + b.passagens.length + b.vales.length, 0);
  ch.push({
    n: 2,
    nome: "Todas as linhas com data e hora foram lidas",
    ok: out.registrosCrus === lidas,
    detalhe: `${out.registrosCrus} linhas com data e hora no arquivo; ${lidas} lidas.`,
  });

  const doResumo = new Set(out.resumo.map((r) => r.placa));
  const dosBlocos = new Set(out.placas.map((b) => b.placa));
  const repetidas = [...vistosBloco.entries()].filter(([, n]) => n > 1).map(([p]) => p);
  const soNoResumo = [...doResumo].filter((p) => !dosBlocos.has(p));
  const soNosBlocos = [...dosBlocos].filter((p) => !doResumo.has(p));
  ch.push({
    n: 3,
    nome: "Placas do resumo = placas do detalhe",
    ok: out.placas.length > 0 && soNoResumo.length === 0 && soNosBlocos.length === 0 && repetidas.length === 0,
    detalhe:
      [
        soNoResumo.length && `no resumo e sem detalhe: ${soNoResumo.join(", ")}`,
        soNosBlocos.length && `no detalhe e fora do resumo: ${soNosBlocos.join(", ")}`,
        repetidas.length && `placa que aparece duas vezes: ${repetidas.join(", ")}`,
      ]
        .filter(Boolean)
        .join("; ") || `${out.placas.length} placa(s).`,
  });

  const problemas4: string[] = [];
  const infos4: string[] = [];
  for (const b of out.placas) {
    const soma = b.passagens.reduce((s, x) => s + (x.dc === "D" ? x.valorCent : -x.valorCent), 0);
    if (b.totais.pedagioCent == null && b.passagens.length > 0) problemas4.push(`${b.placa}: sem "Total de Pedágio"`);
    else if ((b.totais.pedagioCent ?? 0) !== soma)
      problemas4.push(`${b.placa}: linhas somam ${brl(soma)}, "Total de Pedágio" diz ${brl(b.totais.pedagioCent ?? 0)}`);
    const liq = b.vales.reduce((s, x) => s + (x.dc === "D" ? x.valorCent : -x.valorCent), 0);
    if ((b.vales.length > 0 || b.totais.valeCent != null) && (b.totais.valeCent ?? 0) !== liq)
      problemas4.push(`${b.placa}: vale líquido ${brl(liq)}, "Total de Vale" diz ${brl(b.totais.valeCent ?? 0)}`);
    const r = out.resumo.find((x) => x.placa === b.placa);
    if (r && r.qtd !== b.passagens.length + b.vales.length)
      infos4.push(`${b.placa}: resumo conta ${r.qtd} usos, o detalhe tem ${b.passagens.length + b.vales.length} linhas`);
  }
  ch.push({
    n: 4,
    nome: "Total de pedágio e de vale por placa",
    ok: problemas4.length === 0,
    detalhe: [...problemas4, ...infos4].join("; ") || "Bate em todas as placas.",
  });

  const t = out.totalResumo;
  const nf = out.nf;
  const prob5: string[] = [];
  if (!t) prob5.push("sem a linha Total do resumo");
  if (nf.passagensCent == null || nf.totalCent == null) prob5.push("não achei os valores da nota fiscal");
  if (t && nf.passagensCent != null && (t.usoCent !== nf.passagensCent || t.qtd !== nf.passagensQtd))
    prob5.push(`resumo ${t.qtd} usos ${brl(t.usoCent)} × nota ${nf.passagensQtd} ${brl(nf.passagensCent)}`);
  if (t) {
    const somaResumo = out.resumo.reduce((s, r) => s + r.usoCent, 0);
    if (somaResumo !== t.usoCent) prob5.push(`placas somam ${brl(somaResumo)}, linha Total diz ${brl(t.usoCent)}`);
  }
  if (t && nf.totalCent != null) {
    const conta = t.usoCent + t.planoCent + (nf.outrasCent ?? 0);
    if (conta !== nf.totalCent) prob5.push(`uso + planos + outras = ${brl(conta)}, a nota diz ${brl(nf.totalCent)}`);
  }
  ch.push({
    n: 5,
    nome: "Resumo × nota fiscal",
    ok: prob5.length === 0,
    detalhe: prob5.join("; ") || `Nota de ${brl(nf.totalCent ?? 0)} fecha com o resumo.`,
  });

  ch.push({
    n: 6,
    nome: "Nenhuma linha ficou sem ler",
    ok: out.naoLidas.length === 0,
    detalhe: out.naoLidas.length ? `${out.naoLidas.length} linha(s) não lida(s).` : "Todas lidas.",
  });
  out.checagens = ch;

  const linhasLidas = out.placas.reduce((s, b) => s + b.passagens.length + b.vales.length, 0);
  // Placa que a fatura diz ter pedágio e da qual não li NENHUMA passagem: o
  // layout mudou ali. Importar só o vale dela seria pior que não importar.
  const semLeitura = out.placas.filter((b) => (b.totais.pedagioCent ?? 0) !== 0 && b.passagens.length === 0).map((b) => b.placa);
  const falha =
    (!ch[0]!.ok && `Este arquivo não parece uma fatura do Sem Parar: ${ch[0]!.detalhe}`) ||
    (out.placas.length === 0 && "Não achei nenhuma placa no arquivo. Confira se é a fatura mensal do Sem Parar em PDF.") ||
    (linhasLidas === 0 && "Não consegui ler nenhuma passagem. O formato da fatura pode ter mudado.") ||
    (semLeitura.length > 0 &&
      `A fatura cobra pedágio da(s) placa(s) ${semLeitura.join(", ")}, mas não consegui ler nenhuma passagem delas. O formato pode ter mudado.`) ||
    (!ch[2]!.ok && `As placas do resumo não batem com o detalhe (${ch[2]!.detalhe}).`) ||
    null;
  if (falha) {
    out.status = "FALHOU";
    out.motivo = falha;
  } else if (ch.every((x) => x.ok)) {
    out.status = "LIDO";
    out.motivo = null;
  } else {
    out.status = "LIDO_COM_DIVERGENCIA";
    out.motivo = ch
      .filter((x) => !x.ok)
      .map((x) => `${x.nome}: ${x.detalhe}`)
      .join(" · ");
  }
  return out;
}
