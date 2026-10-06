import type { CaixaAchadoTag, TipoAchadoTag } from "@ronan/shared-types";
import { PRAZO_CONTESTACAO_TAG_DIAS } from "@ronan/shared-types";
import { DIA, HORA, MIN, brl, rotuloHora } from "./normalizacao";
import type { PassagemFisica, Trecho, ViagemInferida } from "./trechos";

/**
 * Os achados em R$ — e a regra que mais importa: UMA PASSAGEM, UM BALDE
 * (04-qa B2). A mesma passagem chegou a cair em três caixas e dois achados
 * "fortes" se contradiziam (Nobres nos dois sentidos × vale incompleto).
 *
 * Precedência, do mais forte ao mais fraco:
 *  1. fato do documento: fora do período, cobrada em outra fatura, vale sem
 *     par, ajuste não detalhado;
 *  2. vale da viagem: viagem COM vale nunca entra em "carregado sem vale";
 *     depois da 1ª praça coberta é "vale parcial, provável"; antes, "conferir
 *     a origem" — nunca "provável";
 *  3. carregado sem vale, por viagem inferida inteira;
 *  4. praça: duplicidade, sentidos opostos, praça pulada;
 *  5. eixo e conversa.
 * Quando duas hipóteses querem a mesma passagem e SE EXCLUEM, viram um achado
 * só ("explicações possíveis: A ou B") com o valor contado uma vez.
 *
 * Nada aqui acusa ninguém: "pode ser seu", "pra conferir", "pra conversar".
 */

export type Achado = {
  chave: string;
  tipo: TipoAchadoTag;
  caixa: CaixaAchadoTag;
  placa: string | null;
  extratoId: string | null;
  ancoraId: string | null;
  passagemIds: string[];
  valorCent: number | null;
  titulo: string;
  explicacao: string;
  explicacoes?: string[];
  evidencia?: Record<string, unknown>;
  prazoEm: number | null;
};

export type PassagemComFatos = PassagemFisica & {
  extratoId: string;
  dc: "D" | "C";
  foraDoPeriodo: boolean;
  /** Outra fatura, de período que NÃO se sobrepõe, trouxe a mesma linha. */
  cobradaEmOutraFatura: { numeroFatura: string | null } | null;
};

export type EntradaPlaca = {
  placa: string;
  eixosCarregado: number | null;
  /** Cadastro confirmado por gente (04-qa I6). */
  eixosComposicao: number | null;
  eixosSuspensosVazio: number | null;
  /** Débitos (tag + vale), a linha do tempo física. */
  passagens: PassagemComFatos[];
  /** Todas as linhas de vale (C e D), pra parear. */
  linhasVale: PassagemComFatos[];
  trechos: Trecho[];
  viagens: ViagemInferida[];
  /** A checagem do vale desta placa falhou na leitura: não se acusa vale sem par. */
  valeNaoConfiavel: boolean;
};

export type EntradaAchados = {
  placas: EntradaPlaca[];
  ajustes: { extratoId: string; placa: string; diferencaCent: number; qtdResumo: number; qtdDetalhe: number }[];
  taxas: { extratoId: string; itens: { descricao: string; valorCent: number; qtd: number }[] }[];
  /** km das praças já vistas por rodovia (pra praça pulada). */
  kmsConhecidos: Map<string, number[]>;
};

const OPOSTO: Record<string, string> = { NORTE: "SUL", SUL: "NORTE", LESTE: "OESTE", OESTE: "LESTE" };

/** Tipos que somam passagem a passagem: perdem a passagem que outro balde levou. */
const ADITIVOS = new Set<TipoAchadoTag>(["CARREGADO_SEM_VALE", "VALE_PARCIAL", "VALE_ORIGEM_A_CONFERIR", "EIXO_VAZIO_A_MAIS"]);

/** Leituras alternativas da MESMA cobrança: se colidem, viram um achado só. */
const LEITURA_DE_PRACA = new Set<TipoAchadoTag>(["SENTIDO_OPOSTO_CURTO", "DUPLICIDADE", "EIXO_SOBE_E_DESCE"]);
const LEITURA_DE_VIAGEM = new Set<TipoAchadoTag>(["VALE_ORIGEM_A_CONFERIR", "VALE_PARCIAL", "CARREGADO_SEM_VALE"]);
const seExcluem = (a: TipoAchadoTag, b: TipoAchadoTag) =>
  (LEITURA_DE_PRACA.has(a) && LEITURA_DE_VIAGEM.has(b)) || (LEITURA_DE_VIAGEM.has(a) && LEITURA_DE_PRACA.has(b));

const nome = (p: PassagemFisica) => `${p.cidade} ${p.sentido} ${rotuloHora(p.t, p.offsetMin)}`;
const soma = (ps: PassagemFisica[]) => ps.reduce((s, p) => s + p.valorCent, 0);
const prazo = (ps: PassagemFisica[]) => (ps.length ? Math.min(...ps.map((p) => p.t)) + PRAZO_CONTESTACAO_TAG_DIAS * DIA : null);
const tarifaEixo = (p: PassagemFisica) => (p.eixos ? p.valorCent / p.eixos : null);

type Hipotese = Omit<Achado, "valorCent"> & { valorCent: number | null; prioridade: number; passagens: PassagemFisica[] };

function hip(
  prioridade: number,
  tipo: TipoAchadoTag,
  caixa: CaixaAchadoTag,
  placa: string,
  passagens: PassagemFisica[],
  valorCent: number | null,
  titulo: string,
  explicacao: string,
  evidencia?: Record<string, unknown>,
  ancora?: string,
): Hipotese {
  const ancoraId = ancora ?? passagens[0]?.id ?? null;
  return {
    prioridade,
    chave: `${tipo}|${ancoraId}`,
    tipo,
    caixa,
    placa,
    extratoId: (passagens[0] as PassagemComFatos | undefined)?.extratoId ?? null,
    ancoraId,
    passagemIds: passagens.map((p) => p.id),
    passagens,
    valorCent,
    titulo,
    explicacao,
    evidencia,
    prazoEm: prazo(passagens),
  };
}

export function calcularAchados(e: EntradaAchados): Achado[] {
  const hs: Hipotese[] = [];

  for (const pl of e.placas) {
    const tag = pl.passagens.filter((p) => p.fonte === "TAG");

    // ---- 1. fato do documento ----
    for (const p of tag) {
      if (p.cobradaEmOutraFatura) {
        hs.push(
          hip(1, "COBRADA_EM_OUTRA_FATURA", "PRA_CONTESTAR", pl.placa, [p], p.valorCent, `${nome(p)} em duas faturas`,
            `A mesma passagem (praça, hora, categoria e valor) também está na fatura ${p.cobradaEmOutraFatura.numeroFatura ?? "anterior"}, de outro período. Se foi cobrada duas vezes, dá pra contestar no Sem Parar.`),
        );
      } else if (p.foraDoPeriodo) {
        hs.push(
          hip(1, "FORA_DO_PERIODO", "PRA_CONTESTAR", pl.placa, [p], p.valorCent, `${nome(p)} fora do período`,
            "A passagem é de antes (ou depois) do período desta fatura. Confira se ela não veio também na fatura do mês dela."),
        );
      }
    }
    if (!pl.valeNaoConfiavel) {
      const k = (v: PassagemFisica) => [v.numeroViagemVale, v.chavePraca, v.sentido, v.t, v.valorCent].join("|");
      const cs = new Map<string, PassagemComFatos[]>();
      const ds = new Map<string, PassagemComFatos[]>();
      for (const v of pl.linhasVale) {
        const m = v.dc === "C" ? cs : ds;
        m.set(k(v), [...(m.get(k(v)) ?? []), v]);
      }
      const sobra = [
        ...[...cs.entries()].flatMap(([kk, l]) => l.slice((ds.get(kk) ?? []).length)),
        ...[...ds.entries()].flatMap(([kk, l]) => l.slice((cs.get(kk) ?? []).length)),
      ];
      for (const v of sobra) {
        hs.push(
          hip(1, "VALE_SEM_PAR", "PRA_CONTESTAR", pl.placa, [v], v.valorCent, `Vale ${v.dc === "C" ? "creditado sem a passagem" : "debitado sem o crédito"} em ${nome(v)}`,
            v.dc === "C"
              ? "O embarcador creditou o vale nesta praça, mas a passagem com vale não aparece. Confira com o Sem Parar."
              : "A passagem saiu do vale sem o crédito correspondente na fatura. Confira com o Sem Parar antes de falar com o embarcador."),
        );
      }
    }

    // ---- 2. vale da viagem ----
    for (const v of pl.viagens) {
      if (!v.temVale) continue;
      const vales = v.passagens.filter((p) => p.fonte === "VALE").sort((a, b) => a.t - b.t);
      const primeiro = vales[0]!;
      const doTag = v.passagens.filter((p) => p.fonte === "TAG" && p.sentido === primeiro.sentido);
      const depois = doTag.filter((p) => p.t > primeiro.t);
      const antes = doTag.filter((p) => p.t < primeiro.t);
      const emb = vales.map((x) => x.numeroViagemVale).filter(Boolean);
      if (depois.length)
        hs.push(
          hip(2, "VALE_PARCIAL", "PODE_SER_SEU", pl.placa, depois, soma(depois), `Vale cobriu só parte da viagem de ${rotuloHora(v.ini, primeiro.offsetMin).slice(0, 5)}`,
            `O vale-pedágio desta viagem pagou ${vales.length} praça(s), e a tag pagou ${depois.map(nome).join(", ")} no mesmo sentido, depois da 1ª praça coberta. Provável que fosse da rota do vale.`,
            { valeViagens: [...new Set(emb)] }, v.ancoraId),
        );
      if (antes.length)
        hs.push(
          hip(2, "VALE_ORIGEM_A_CONFERIR", "PRA_CONTESTAR", pl.placa, antes, soma(antes), `Praça antes do vale em ${rotuloHora(v.ini, primeiro.offsetMin).slice(0, 5)}: onde carregou?`,
            `A tag pagou ${antes.map(nome).join(", ")} antes da 1ª praça que o vale cobriu. Se carregou antes dela, o vale devia cobrir; se carregou depois, a cobrança está certa.`,
            undefined, `${v.ancoraId}:origem`),
        );
    }

    // ---- 3. carregado sem vale, por viagem inferida ----
    for (const v of pl.viagens) {
      if (v.temVale) continue;
      const ps = v.passagens.filter((p) => p.fonte === "TAG");
      if (!ps.length) continue;
      const pr = ps[0]!;
      const ult = ps.at(-1)!;
      hs.push(
        hip(3, "CARREGADO_SEM_VALE", "PODE_SER_SEU", pl.placa, ps, soma(ps), `Viagem carregada de ${rotuloHora(v.ini, pr.offsetMin)} sem vale`,
          `${pr.cidade} → ${ult.cidade}, ${ps.length} praça(s) com ${pr.eixos ?? "?"} eixos, pagas inteiras pela tag. Se a carga era de terceiro, o contratante devia ter dado o vale-pedágio.`,
          { ini: v.ini, fim: v.fim, pracas: ps.map(nome) }, v.ancoraId),
      );
    }

    // ---- 4. praça ----
    const tl = pl.passagens;
    for (let i = 0; i < tl.length; i++) {
      for (let j = i + 1; j < tl.length && tl[j]!.t - tl[i]!.t <= 30 * MIN; j++) {
        const a = tl[i]!;
        const b = tl[j]!;
        if (a.chavePraca === b.chavePraca && a.sentido === b.sentido && (a.fonte === "TAG" || b.fonte === "TAG"))
          hs.push(
            hip(4, "DUPLICIDADE", "PRA_CONTESTAR", pl.placa, [a, b], Math.min(a.valorCent, b.valorCent), `${a.cidade} cobrada duas vezes no mesmo sentido`,
              `${nome(a)} e ${nome(b)}: mesma praça, mesmo sentido, ${Math.round((b.t - a.t) / MIN)} min de diferença.`),
          );
      }
    }
    for (let i = 0; i + 1 < tl.length; i++) {
      const a = tl[i]!;
      const b = tl[i + 1]!;
      if (a.chavePraca === b.chavePraca && OPOSTO[a.sentido] === b.sentido && b.t - a.t <= 15 * MIN) {
        const minutos = Math.max(1, Math.round((b.t - a.t) / MIN));
        hs.push(
          hip(4, "SENTIDO_OPOSTO_CURTO", "PRA_CONTESTAR", pl.placa, [a, b], a.valorCent, `${a.cidade} nos dois sentidos em ${minutos} min`,
            `${nome(a)} e ${nome(b)}. Ou foi retorno na praça (as duas cobranças estão certas), ou leitura dupla (a de ${a.sentido} é contestável) — nunca as duas.`),
        );
      }
    }
    for (let i = 0; i + 1 < tl.length; i++) {
      const a = tl[i]!;
      const b = tl[i + 1]!;
      if (a.rodovia !== b.rodovia || a.sentido !== b.sentido || !a.rodovia.startsWith("BR") || b.t - a.t > 12 * HORA) continue;
      const [lo, hi] = [Math.min(a.kmMetros, b.kmMetros), Math.max(a.kmMetros, b.kmMetros)];
      const pulou = (e.kmsConhecidos.get(a.rodovia) ?? []).filter((k) => k > lo && k < hi);
      if (!pulou.length) continue;
      // Mudou de eixo entre as pontas = carregou no caminho: nada a achar (04-qa I8).
      if (a.eixos !== b.eixos) continue;
      hs.push(
        hip(4, "PRACA_PULADA", "PRA_CONVERSAR", pl.placa, [a, b], null, `Praça sem cobrança entre ${a.cidade} e ${b.cidade}`,
          `Entre ${nome(a)} e ${nome(b)} existe praça no caminho (km ${pulou.map((k) => (k / 1000).toFixed(1)).join(", ")}) que a tag não cobrou: a tag não leu, ele pagou em dinheiro, ou entrou depois dela. Sozinha, não prova nada.`),
      );
    }

    // ---- 5. eixo e conversa ----
    if (pl.eixosComposicao) {
      for (const p of tag) {
        if (p.eixos != null && p.eixos > pl.eixosComposicao) {
          const t = tarifaEixo(p);
          hs.push(
            hip(5, "EIXO_ACIMA_DO_CADASTRO", "PRA_CONTESTAR", pl.placa, [p], t ? Math.round((p.eixos - pl.eixosComposicao) * t) : null,
              `${p.eixos} eixos cobrados em ${nome(p)}`,
              `O cadastro diz ${pl.eixosComposicao} eixos na composição de costume. Pode ter sido outra carreta naquele dia — a conferir, não é indevido certo.`),
          );
        }
      }
    }
    const viz = (i: number, d: number) => {
      const y = tl[i + d];
      return y && y.sentido === tl[i]!.sentido && Math.abs(y.t - tl[i]!.t) <= 6 * HORA ? y : null;
    };
    tl.forEach((x, i) => {
      const a = viz(i, -1);
      const b = viz(i, +1);
      if (x.fonte !== "TAG" || !a || !b || a.eixos == null || x.eixos == null || a.eixos !== b.eixos || x.eixos <= a.eixos) return;
      const t = tarifaEixo(x);
      hs.push(
        hip(5, "EIXO_SOBE_E_DESCE", "PRA_CONVERSAR", pl.placa, [x], t ? Math.round((x.eixos - a.eixos) * t) : null,
          `Eixo sobe e desce em ${nome(x)}`,
          `${a.eixos} → ${x.eixos} → ${b.eixos} eixos no mesmo sentido. O motorista pode ter baixado o eixo (ou o MDF-e estava aberto): conversa, não contestação.`),
      );
    });
    if (pl.eixosComposicao && pl.eixosSuspensosVazio) {
      const esperado = pl.eixosComposicao - pl.eixosSuspensosVazio;
      const vazios = new Set(pl.trechos.filter((t) => t.estado === "VAZIO").flatMap((t) => t.passagens.map((p) => p.id)));
      const amais = tag.filter((p) => vazios.has(p.id) && p.eixos != null && p.eixos > esperado);
      const valor = amais.reduce((s, p) => s + Math.round((p.eixos! - esperado) * (tarifaEixo(p) ?? 0)), 0);
      if (amais.length)
        hs.push(
          hip(5, "EIXO_VAZIO_A_MAIS", "PRA_CONVERSAR", pl.placa, amais, valor, `${amais.length} passagem(ns) vazia(s) com mais de ${esperado} eixos no chão`,
            `Vazio, o cadastro diz que ele suspende ${pl.eixosSuspensosVazio} eixo(s) e roda com ${esperado}. Vale uma conversa com o motorista — nunca acusação.`,
            undefined, `${pl.placa}:${amais[0]!.id}`),
        );
    }
  }

  // ---- precedência: uma passagem, um balde ----
  hs.sort((a, b) => a.prioridade - b.prioridade);
  const dono = new Map<string, Achado & { prioridade: number }>();
  const aceitos: (Achado & { prioridade: number; valorOriginal?: number | null })[] = [];
  for (const h of hs) {
    const donos = [...new Set(h.passagemIds.map((id) => dono.get(id)).filter((d): d is NonNullable<typeof d> => !!d))];
    if (donos.length === 0) {
      const { passagens: _p, ...a } = h;
      void _p;
      aceitos.push(a);
      for (const id of a.passagemIds) dono.set(id, a);
      continue;
    }
    const excludente = donos.find((d) => seExcluem(d.tipo === "EXPLICACOES_POSSIVEIS" ? (d.evidencia?.tipoOriginal as TipoAchadoTag) : d.tipo, h.tipo));
    if (excludente && donos.length === 1) {
      const d = excludente;
      if (d.tipo !== "EXPLICACOES_POSSIVEIS") {
        d.explicacoes = [d.explicacao];
        d.evidencia = { ...(d.evidencia ?? {}), tipoOriginal: d.tipo };
        d.tipo = "EXPLICACOES_POSSIVEIS";
      }
      d.explicacoes!.push(h.explicacao);
      d.titulo = `${d.titulo} — ou: ${h.titulo}`;
      d.caixa = "PRA_CONTESTAR";
      for (const id of h.passagemIds) {
        if (!dono.has(id)) {
          dono.set(id, d);
          d.passagemIds.push(id);
        }
      }
      d.prazoEm = Math.min(d.prazoEm ?? Infinity, h.prazoEm ?? Infinity);
      if (!Number.isFinite(d.prazoEm)) d.prazoEm = null;
      continue;
    }
    if (!ADITIVOS.has(h.tipo)) continue;
    const livres = h.passagens.filter((p) => !dono.has(p.id));
    if (!livres.length) continue;
    const { passagens: _p, ...a } = h;
    void _p;
    const r = { ...a, passagemIds: livres.map((p) => p.id), valorCent: soma(livres), prazoEm: prazo(livres) };
    aceitos.push(r);
    for (const id of r.passagemIds) dono.set(id, r);
  }

  // ---- achados sem passagem (do documento) ----
  for (const aj of e.ajustes) {
    if (aj.diferencaCent === 0 && aj.qtdResumo === aj.qtdDetalhe) continue;
    aceitos.push({
      prioridade: 1,
      chave: `AJUSTE_NAO_DETALHADO|${aj.extratoId}|${aj.placa}`,
      tipo: "AJUSTE_NAO_DETALHADO",
      caixa: "PRA_CONTESTAR",
      placa: aj.placa,
      extratoId: aj.extratoId,
      ancoraId: null,
      passagemIds: [],
      valorCent: Math.abs(aj.diferencaCent),
      titulo: `Resumo e detalhe não batem na placa ${aj.placa}`,
      explicacao:
        `O resumo cobra ${aj.qtdResumo} usos e o detalhe lista ${aj.qtdDetalhe} linhas; ` +
        `a diferença é de ${brl(Math.abs(aj.diferencaCent))} ${aj.diferencaCent < 0 ? "a seu favor" : "contra você"}, sem explicação na fatura. ` +
        "Peça o extrato detalhado no portal do Sem Parar pra saber o que é.",
      prazoEm: null,
    });
  }
  for (const tx of e.taxas) {
    const total = tx.itens.reduce((s, i) => s + i.valorCent, 0);
    if (total <= 0) continue;
    aceitos.push({
      prioridade: 5,
      chave: `TAXAS_NAO_PEDAGIO|${tx.extratoId}`,
      tipo: "TAXAS_NAO_PEDAGIO",
      caixa: "PRA_CONVERSAR",
      placa: null,
      extratoId: tx.extratoId,
      ancoraId: null,
      passagemIds: [],
      valorCent: total,
      titulo: "O que a fatura cobra que não é pedágio",
      explicacao: tx.itens.map((i) => `${i.descricao}${i.qtd > 1 ? ` (${i.qtd}×)` : ""}: ${brl(i.valorCent)}`).join("; "),
      prazoEm: null,
    });
  }
  return aceitos.map(({ prioridade: _x, ...a }) => (void _x, a));
}
