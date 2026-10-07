import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { RoteamentoService } from "../../roteamento/roteamento.service";
import { GeocodingService } from "../../geocoding/geocoding.service";
import { PedagiosRodoviaConsultaService } from "../pedagios-rodovia/pedagios-rodovia-consulta.service";
import { PrecificacaoService } from "../tabelas-preco/precificacao.service";
import { atualizarPedagioPelaTag } from "../../common/tag-pedagio/pedagio-do-cliente";
import { distanciaMetros } from "../../common/geo";
import { contaIdAtual } from "../../common/conta/conta-context";
import { calcularAchados, type EntradaPlaca, type PassagemComFatos } from "../../common/tag-pedagio/achados";
import {
  CONFIG_CRUZAMENTO_PADRAO,
  cruzar,
  type ResultadoTrecho,
  type ViagemParaCruzar,
} from "../../common/tag-pedagio/cruzamento";
import { DIA, MIN, normalizarPlaca, variantesDaPlaca } from "../../common/tag-pedagio/normalizacao";
import {
  agruparNos,
  cadeiaConfere,
  candidatosDaPraca,
  decidirPraca,
  paresDaCadeia,
  tarifaConfere,
  type GrupoPraca,
  type PracaDoExtrato,
} from "../../common/tag-pedagio/pracas";
import {
  cortarTrechos,
  eixosDeCarregado,
  viagensInferidas,
  type PassagemFisica,
  type Trecho,
} from "../../common/tag-pedagio/trechos";

const OPERADORA = "SEM_PARAR";
const cent = (d: Prisma.Decimal | number | null | undefined) => (d == null ? 0 : Math.round(Number(d) * 100));

/** Praça do extrato com o ponto do mapa já resolvido (ou não). */
export type PracaResolvida = PracaDoExtrato & {
  pedagioRodoviaId: string | null;
  lat: number | null;
  lng: number | null;
  /** CONTA | CONFIRMADA | AUTOMATICA | null (na fila) */
  origem: string | null;
  nome: string | null;
};

type PassagemCarregada = Awaited<ReturnType<TagProcessamentoService["carregarPassagens"]>>[number];

/**
 * O motor da conferência da tag: de-para das praças, trechos, cruzamento com
 * as viagens e achados. Roda depois de cada importação e quando alguém pede
 * "recalcular" (viagem lançada depois da fatura). O que é decisão de gente
 * mora em outras tabelas, ancorado na passagem, e não é tocado aqui.
 */
@Injectable()
export class TagProcessamentoService {
  private readonly log = new Logger(TagProcessamentoService.name);
  /** Minutos de estrada entre dois pontos (OSRM), por par de coordenadas. */
  private readonly tempos = new Map<string, number | null>();
  private readonly distancias = new Map<string, number | null>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly roteamento: RoteamentoService,
    private readonly geocoding: GeocodingService,
    private readonly pedagios: PedagiosRodoviaConsultaService,
    private readonly precificacao: PrecificacaoService,
  ) {}

  /** Pedágio pela tag na régua do cliente (ver common/tag-pedagio/pedagio-do-cliente). */
  atualizarPedagioDoCliente(ids?: string[]) {
    return atualizarPedagioPelaTag(this.prisma, (id) => this.precificacao.recalcularSeguro(id), ids);
  }

  // ------------------------------------------------------------------ dados

  carregarPassagens() {
    return this.prisma.passagemTag.findMany({
      where: { extrato: { status: { not: "FALHOU" } } },
      orderBy: [{ ocorridoEm: "asc" }, { linhaPdf: "asc" }],
      include: {
        extrato: { select: { id: true, formato: true, periodoDe: true, periodoAte: true, numeroFatura: true, importadoEm: true, status: true, conferencia: true } },
      },
    });
  }

  private async rota(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
    const k = `${a.lat.toFixed(5)},${a.lng.toFixed(5)}|${b.lat.toFixed(5)},${b.lng.toFixed(5)}`;
    if (!this.tempos.has(k)) {
      const r = await this.roteamento.calcularEntreCoordenadas(a, b);
      this.tempos.set(k, r.km != null && "duracaoSegundos" in r && r.duracaoSegundos != null ? r.duracaoSegundos / 60 : null);
      this.distancias.set(k, r.km != null ? Number(r.km) : null);
    }
    return { min: this.tempos.get(k) ?? null, km: this.distancias.get(k) ?? null };
  }

  // ------------------------------------------------------------- praças

  /**
   * Resolve cada praça do extrato: o de-para da empresa vence o global; o que
   * não tem de-para tenta casar sozinho (e grava como AUTOMATICA no global,
   * que é dado público); o resto fica na fila.
   */
  async resolverPracas(pracas: PracaDoExtrato[]): Promise<Map<string, PracaResolvida>> {
    const chaves = pracas.map((p) => p.chave);
    const [daConta, globais] = await Promise.all([
      this.prisma.pracaTagDeParaConta.findMany({
        where: { operadora: OPERADORA, chavePraca: { in: chaves } },
        include: { pedagioRodovia: { select: { lat: true, lng: true, nome: true } } },
      }),
      this.prisma.pracaTagDePara.findMany({
        where: { operadora: OPERADORA, chavePraca: { in: chaves } },
        include: { pedagioRodovia: { select: { lat: true, lng: true, nome: true } } },
      }),
    ]);
    const out = new Map<string, PracaResolvida>();
    for (const p of pracas) {
      const c = daConta.find((x) => x.chavePraca === p.chave);
      const g = globais.find((x) => x.chavePraca === p.chave);
      const alvo = c ?? g;
      out.set(p.chave, {
        ...p,
        pedagioRodoviaId: alvo?.pedagioRodoviaId ?? null,
        lat: alvo?.pedagioRodovia.lat ?? null,
        lng: alvo?.pedagioRodovia.lng ?? null,
        nome: alvo?.pedagioRodovia.nome ?? null,
        origem: c ? "CONTA" : g ? g.origem : null,
      });
    }

    const pendentes = pracas.filter((p) => !out.get(p.chave)!.pedagioRodoviaId);
    if (pendentes.length === 0) return out;
    const analise = await this.analisarPracas(pracas, out);
    for (const p of pendentes) {
      const a = analise.get(p.chave);
      if (!a || a.decisao.status !== "CASOU" || !a.decisao.grupo) continue;
      const g = a.decisao.grupo;
      try {
        await this.prisma.pracaTagDePara.upsert({
          where: { operadora_chavePraca: { operadora: OPERADORA, chavePraca: p.chave } },
          create: {
            operadora: OPERADORA,
            chavePraca: p.chave,
            pedagioRodoviaId: g.id,
            origem: "AUTOMATICA",
            evidencia: { motivo: a.decisao.motivo, cidade: p.cidade } as Prisma.InputJsonValue,
          },
          update: {},
        });
      } catch (e) {
        this.log.warn(`De-para automático de ${p.chave} não gravou: ${(e as Error).message}`);
      }
      out.set(p.chave, { ...out.get(p.chave)!, pedagioRodoviaId: g.id, lat: g.lat, lng: g.lng, nome: g.nome, origem: "AUTOMATICA" });
    }
    return out;
  }

  /** Candidatos e decisão de cada praça (também alimenta a fila da tela). */
  async analisarPracas(
    pracas: PracaDoExtrato[],
    resolvidas: Map<string, PracaResolvida>,
    raioKm?: number,
  ) {
    const out = new Map<
      string,
      {
        sede: { lat: number; lng: number } | null;
        candidatos: { grupo: GrupoPraca; distanciaKm: number }[];
        cadeia: { com: string; ok: boolean; dKmExtrato: number; dKmEstrada: number }[];
        tarifaOk: boolean | null;
        decisao: ReturnType<typeof decidirPraca>;
      }
    >();
    const base = new Map<string, { sede: { lat: number; lng: number } | null; candidatos: { grupo: GrupoPraca; distanciaKm: number }[] }>();
    for (const p of pracas) {
      const sede = await this.geocoding.sedeDoMunicipio(p.cidade, p.uf);
      let candidatos: { grupo: GrupoPraca; distanciaKm: number }[] = [];
      if (sede) {
        const d = (raioKm ?? 40) / 100;
        const nos = await this.prisma.pedagioRodovia.findMany({
          where: { ativo: true, lat: { gte: sede.lat - d, lte: sede.lat + d }, lng: { gte: sede.lng - d, lte: sede.lng + d } },
          select: { id: true, nome: true, lat: true, lng: true, rodovia: true, concessionaria: true, valorBase: true },
        });
        const grupos = agruparNos(nos.map((n) => ({ ...n, valorBase: n.valorBase == null ? null : Number(n.valorBase) })));
        candidatos = candidatosDaPraca(p, grupos, sede, raioKm);
        // Na fila (raio largo), depois das da mesma rodovia, as praças de
        // qualquer rodovia perto da cidade — a concessionária chama tudo de
        // "MT246", mas no mapa duas delas estão na MT-358 (05 §1a). Só sugere.
        if (raioKm) {
          const ja = new Set(candidatos.map((c) => c.grupo.id));
          candidatos = [
            ...candidatos,
            ...grupos
              .filter((g) => !ja.has(g.id))
              .map((g) => ({ grupo: g, distanciaKm: distanciaMetros(sede.lat, sede.lng, g.lat, g.lng) / 1000 }))
              .filter((c) => c.distanciaKm <= raioKm)
              .sort((a, b) => a.distanciaKm - b.distanciaKm),
          ];
        }
      }
      base.set(p.chave, { sede, candidatos });
    }
    const cadeias = new Map<string, { com: string; ok: boolean; dKmExtrato: number; dKmEstrada: number }[]>();
    for (const [a, b] of paresDaCadeia(pracas)) {
      const pa = resolvidas.get(a.chave)?.lat != null ? resolvidas.get(a.chave)! : null;
      const pb = resolvidas.get(b.chave)?.lat != null ? resolvidas.get(b.chave)! : null;
      const ca = pa ? { lat: pa.lat!, lng: pa.lng! } : base.get(a.chave)?.candidatos.length === 1 ? base.get(a.chave)!.candidatos[0]!.grupo : null;
      const cb = pb ? { lat: pb.lat!, lng: pb.lng! } : base.get(b.chave)?.candidatos.length === 1 ? base.get(b.chave)!.candidatos[0]!.grupo : null;
      if (!ca || !cb) continue;
      const dKmExtrato = Math.abs(b.kmMetros - a.kmMetros) / 1000;
      const r = await this.rota(ca, cb);
      const dKmEstrada = r.km ?? distanciaMetros(ca.lat, ca.lng, cb.lat, cb.lng) / 1000;
      if (r.km == null) continue; // sem OSRM não confirma nem derruba
      const ok = cadeiaConfere(dKmExtrato, dKmEstrada);
      cadeias.set(a.chave, [...(cadeias.get(a.chave) ?? []), { com: `${b.cidade} km ${(b.kmMetros / 1000).toFixed(1)}`, ok, dKmExtrato, dKmEstrada }]);
      cadeias.set(b.chave, [...(cadeias.get(b.chave) ?? []), { com: `${a.cidade} km ${(a.kmMetros / 1000).toFixed(1)}`, ok, dKmExtrato, dKmEstrada }]);
    }
    for (const p of pracas) {
      const { sede, candidatos } = base.get(p.chave)!;
      const cadeia = cadeias.get(p.chave) ?? [];
      const tarifaOk = candidatos.length === 1 ? tarifaConfere(p, candidatos[0]!.grupo) : null;
      out.set(p.chave, { sede, candidatos, cadeia, tarifaOk, decisao: decidirPraca(p, candidatos, cadeia, tarifaOk) });
    }
    return out;
  }

  /** As praças distintas das passagens, com a tarifa por eixo mais recente. */
  pracasDasPassagens(ps: PassagemCarregada[]): PracaDoExtrato[] {
    const m = new Map<string, PracaDoExtrato & { t: number }>();
    for (const p of ps) {
      const atual = m.get(p.chavePraca);
      const t = p.ocorridoEm.getTime();
      const tarifa = p.eixosCobrados ? Math.round(cent(p.valor) / p.eixosCobrados) : null;
      if (!atual || t >= atual.t)
        m.set(p.chavePraca, {
          operadora: OPERADORA,
          chave: p.chavePraca,
          rodovia: p.rodovia,
          kmMetros: p.kmMetros,
          cidade: p.cidade,
          concessionaria: p.concessionaria ?? atual?.concessionaria ?? null,
          uf: p.uf ?? atual?.uf ?? null,
          tarifaEixoCent: tarifa ?? atual?.tarifaEixoCent ?? null,
          t,
        });
    }
    return [...m.values()].map(({ t: _t, ...p }) => (void _t, p));
  }

  // -------------------------------------------------------- processamento

  /**
   * Recalcula tudo da conta: trechos, cruzamento e achados. Idempotente — a
   * decisão de gente (ligação, resposta, praça, status do achado) sobrevive.
   */
  async processar(): Promise<{ trechos: number; achados: number }> {
    const ps = await this.carregarPassagens();
    const conta = await this.prisma.conta.findUnique({ where: { id: contaIdAtual() }, select: { ligacaoAutomaticaTag: true } });
    if (ps.length === 0) {
      await this.prisma.trechoTag.deleteMany({});
      await this.prisma.achadoTag.updateMany({ where: { vigente: true }, data: { vigente: false } });
      await this.atualizarPedagioDoCliente();
      return { trechos: 0, achados: 0 };
    }

    // Mesma linha em dois documentos: entre faturas de períodos que NÃO se
    // sobrepõem é "cobrada em outra fatura"; senão o 2º só enriquece (04-qa I3).
    const porChave = new Map<string, PassagemCarregada[]>();
    for (const p of ps) porChave.set(p.chave, [...(porChave.get(p.chave) ?? []), p]);
    const repetidas = new Map<string, { numeroFatura: string | null }>();
    const ignoradas = new Set<string>();
    for (const lista of porChave.values()) {
      if (lista.length < 2) continue;
      const ord = [...lista].sort((a, b) => a.extrato.importadoEm.getTime() - b.extrato.importadoEm.getTime());
      const primeira = ord[0]!;
      for (const outra of ord.slice(1)) {
        if (outra.extratoId === primeira.extratoId) continue;
        ignoradas.add(outra.id);
        const disjuntos =
          primeira.extrato.formato === "PDF_FATURA" &&
          outra.extrato.formato === "PDF_FATURA" &&
          primeira.extrato.periodoDe && primeira.extrato.periodoAte && outra.extrato.periodoDe && outra.extrato.periodoAte &&
          (outra.extrato.periodoDe > primeira.extrato.periodoAte || outra.extrato.periodoAte < primeira.extrato.periodoDe);
        if (disjuntos) repetidas.set(outra.id, { numeroFatura: primeira.extrato.numeroFatura });
      }
    }

    const pracas = await this.resolverPracas(this.pracasDasPassagens(ps));
    const gps = (chave: string) => {
      const r = pracas.get(chave);
      return r?.lat != null && r.lng != null ? { lat: r.lat, lng: r.lng } : null;
    };
    // Tempos de rota pré-calculados pros pares consecutivos (a função do corte é síncrona).
    const tempoPar = new Map<string, number | null>();
    const porPlaca = new Map<string, PassagemCarregada[]>();
    for (const p of ps) porPlaca.set(p.placaTexto, [...(porPlaca.get(p.placaTexto) ?? []), p]);
    for (const lista of porPlaca.values()) {
      const fisicas = lista.filter((p) => p.dc === "D" && !ignoradas.has(p.id));
      for (let i = 0; i + 1 < fisicas.length; i++) {
        const a = fisicas[i]!.chavePraca;
        const b = fisicas[i + 1]!.chavePraca;
        const k = `${a}>${b}`;
        if (a === b || tempoPar.has(k)) continue;
        const ga = gps(a);
        const gb = gps(b);
        tempoPar.set(k, ga && gb ? (await this.rota(ga, gb)).min : null);
      }
    }
    const tempo = (a: string, b: string) => tempoPar.get(`${a}>${b}`) ?? null;

    // Veículos: placa da fatura → cadastro (Mercosul ou antiga).
    const veiculos = await this.prisma.veiculo.findMany({
      select: { id: true, placa: true, eixosComposicao: true, eixosSuspensosVazio: true },
    });
    const veiculoDaPlaca = new Map<string, (typeof veiculos)[number]>();
    for (const v of veiculos) for (const variante of variantesDaPlaca(v.placa)) veiculoDaPlaca.set(variante, v);
    // A fatura costuma subir ANTES de a frota estar cadastrada: a placa fica
    // "sem cadastro" desde a importação. Caminhão cadastrado depois é ligado aqui,
    // a cada processamento — senão o raio-x mentia "sem cadastro" pra sempre.
    await this.religarPlacas(veiculoDaPlaca);

    const fisica = (p: PassagemCarregada): PassagemComFatos => {
      const dataLocal = new Date(p.ocorridoEm.getTime() + p.fusoOffsetMin * MIN).toISOString().slice(0, 10);
      const de = p.extrato.periodoDe?.toISOString().slice(0, 10);
      const ate = p.extrato.periodoAte?.toISOString().slice(0, 10);
      return {
        id: p.id,
        placa: normalizarPlaca(p.placaTexto),
        t: p.ocorridoEm.getTime(),
        offsetMin: p.fusoOffsetMin,
        chavePraca: p.chavePraca,
        rodovia: p.rodovia,
        kmMetros: p.kmMetros,
        sentido: p.sentido,
        cidade: p.cidade,
        eixos: p.eixosCobrados || null,
        valorCent: cent(p.valor),
        fonte: p.tipo === "VALE" ? "VALE" : "TAG",
        numeroViagemVale: p.numeroViagemVale,
        extratoId: p.extratoId,
        dc: p.dc as "D" | "C",
        foraDoPeriodo: !!(de && ate && (dataLocal < de || dataLocal > ate)),
        cobradaEmOutraFatura: repetidas.get(p.id) ?? null,
      };
    };

    const entradas: EntradaPlaca[] = [];
    const todosTrechos: Trecho[] = [];
    const eixosPorPlaca = new Map<string, { eixos: number | null; origem: string; contagem: Record<number, number> }>();
    for (const [placaTexto, lista] of porPlaca) {
      const placa = normalizarPlaca(placaTexto);
      const v = veiculoDaPlaca.get(placa);
      const passagens = lista.filter((p) => p.dc === "D" && !ignoradas.has(p.id)).map(fisica);
      // A duplicada entre faturas fica fora da linha do tempo (o caminhão passou uma vez), mas vira achado.
      const duplicadas = lista.filter((p) => repetidas.has(p.id) && p.tipo === "PEDAGIO").map(fisica);
      const tagCarregadas = passagens.filter((p) => p.fonte === "TAG");
      const eixos = eixosDeCarregado(tagCarregadas, v?.eixosComposicao ?? null);
      eixosPorPlaca.set(placa, eixos);
      const trechos = cortarTrechos(passagens, eixos.eixos, tempo);
      todosTrechos.push(...trechos);
      const doc = (lista[0]!.extrato.conferencia ?? {}) as { valeNaoConfiavel?: string[] };
      entradas.push({
        placa,
        eixosCarregado: eixos.eixos,
        eixosComposicao: v?.eixosComposicao ?? null,
        eixosSuspensosVazio: v?.eixosSuspensosVazio ?? null,
        passagens: [...passagens, ...duplicadas].sort((a, b) => a.t - b.t),
        linhasVale: lista.filter((p) => p.tipo === "VALE" && !ignoradas.has(p.id)).map(fisica),
        trechos,
        viagens: viagensInferidas(trechos),
        valeNaoConfiavel: (doc.valeNaoConfiavel ?? []).includes(placa),
      });
    }

    // ---- viagens candidatas: dos caminhões da fatura, na janela das passagens ----
    const veiculoIds = [...new Set(entradas.map((e) => veiculoDaPlaca.get(e.placa)?.id).filter((x): x is string => !!x))];
    const placaDoVeiculo = new Map<string, string>();
    for (const e of entradas) {
      const v = veiculoDaPlaca.get(e.placa);
      if (v) placaDoVeiculo.set(v.id, e.placa);
    }
    const tMin = Math.min(...ps.map((p) => p.ocorridoEm.getTime())) - 3 * DIA;
    const tMax = Math.max(...ps.map((p) => p.ocorridoEm.getTime())) + 3 * DIA;
    const viagensDb = veiculoIds.length
      ? await this.prisma.viagem.findMany({
          where: {
            veiculoId: { in: veiculoIds },
            OR: [
              { data: { gte: new Date(tMin), lte: new Date(tMax) } },
              { iniciadoEm: { gte: new Date(tMin), lte: new Date(tMax) } },
            ],
          },
          select: {
            id: true,
            veiculoId: true,
            localCargaId: true,
            localDescargaId: true,
            rotaGeometria: true,
            data: true,
            iniciadoEm: true,
            eventosViagem: { select: { ocorridoEm: true }, orderBy: { ocorridoEm: "desc" }, take: 1 },
          },
        })
      : [];
    const duracaoDoPar = await this.garantirRotas(viagensDb);
    const emOrdem = await this.pedagios.pracasEmOrdemDasViagens(viagensDb.map((v) => v.id));
    const chaveDoPonto = (lat: number, lng: number): string | null => {
      for (const r of pracas.values()) {
        if (r.lat != null && r.lng != null && distanciaMetros(r.lat, r.lng, lat, lng) < 5000) return r.chave;
      }
      return null;
    };
    const viagens: ViagemParaCruzar[] = viagensDb.map((v) => {
      const ord = emOrdem.get(v.id);
      let lista: ViagemParaCruzar["pracas"] = null;
      if (ord) {
        lista = [];
        for (const p of ord) {
          const chave = chaveDoPonto(p.lat, p.lng) ?? `?${p.id}`;
          if (!lista.some((x) => x.chave === chave)) lista.push({ chave, ordem: lista.length, rumo: p.rumo });
        }
      }
      const ultimoEvento = v.eventosViagem[0]?.ocorridoEm ?? null;
      return {
        id: v.id,
        placa: placaDoVeiculo.get(v.veiculoId) ?? "",
        data: v.data ? v.data.toISOString().slice(0, 10) : null,
        ini: v.iniciadoEm ? v.iniciadoEm.getTime() : null,
        fim: v.iniciadoEm && ultimoEvento ? ultimoEvento.getTime() : null,
        duracaoMin:
          v.localCargaId && v.localDescargaId ? (duracaoDoPar.get(`${v.localCargaId}>${v.localDescargaId}`) ?? null) : null,
        pracas: lista,
      };
    });

    const resultado = cruzar(todosTrechos, viagens, {
      ...CONFIG_CRUZAMENTO_PADRAO,
      ligacaoAutomatica: !!conta?.ligacaoAutomaticaTag,
    });

    await this.gravarLigacoesAutomaticas(resultado);
    await this.gravarTrechos(todosTrechos, resultado, entradas, veiculoDaPlaca);
    const achados = calcularAchados({
      placas: entradas,
      ajustes: await this.ajustes(),
      taxas: await this.taxas(),
      kmsConhecidos: kmsPorRodovia(ps),
    });
    await this.gravarAchados(achados, veiculoDaPlaca);
    await this.prisma.extratoTag.updateMany({ where: { status: { not: "FALHOU" } }, data: { processadoEm: new Date() } });
    await this.atualizarPedagioDoCliente();
    return { trechos: todosTrechos.length, achados: achados.length };
  }

  /** Liga ao cadastro as placas da fatura que ainda estão sem caminhão. */
  private async religarPlacas(veiculoDaPlaca: Map<string, { id: string }>) {
    const soltas = await this.prisma.extratoTagVeiculo.findMany({
      where: { veiculoId: null },
      select: { placaTexto: true },
      distinct: ["placaTexto"],
    });
    for (const { placaTexto } of soltas) {
      const v = veiculoDaPlaca.get(normalizarPlaca(placaTexto));
      if (!v) continue;
      await this.prisma.extratoTagVeiculo.updateMany({ where: { placaTexto, veiculoId: null }, data: { veiculoId: v.id } });
      await this.prisma.passagemTag.updateMany({ where: { placaTexto, veiculoId: null }, data: { veiculoId: v.id } });
    }
  }

  /**
   * Viagem sem rota no cache não tem praça pra comparar e nunca vira candidata
   * — é o caso da viagem importada, ou lançada sem sinal, antes de o cron de km
   * passar por ela. Calcula aqui a rota que faltar (o cálculo grava no cache),
   * em vez de dizer "sem viagem lançada" pra uma viagem que está lá.
   *
   * Devolve quanto cada par carga→descarga leva (minutos): é a janela da
   * viagem lançada sem horário (ver `duracaoMin` no cruzamento).
   */
  private async garantirRotas(
    viagens: Array<{ localCargaId: string | null; localDescargaId: string | null }>,
  ): Promise<Map<string, number | null>> {
    const duracao = new Map<string, number | null>();
    for (const v of viagens) {
      if (!v.localCargaId || !v.localDescargaId) continue;
      const par = `${v.localCargaId}>${v.localDescargaId}`;
      if (duracao.has(par)) continue;
      try {
        const r = await this.roteamento.calcularKm(v.localCargaId, v.localDescargaId);
        duracao.set(par, r.km != null && "duracaoSegundos" in r && r.duracaoSegundos != null ? r.duracaoSegundos / 60 : null);
      } catch (err) {
        duracao.set(par, null);
        this.log.warn(`rota ${par} falhou: ${(err as Error).message}`);
      }
    }
    return duracao;
  }

  /** AUTO (só com a ligação automática ligada) vira ligação do sistema — nunca por cima de gente. */
  private async gravarLigacoesAutomaticas(res: Map<string, ResultadoTrecho>) {
    const ancoras = [...res.keys()];
    const existentes = await this.prisma.ligacaoTagViagem.findMany({ where: { passagemAncoraId: { in: ancoras } } });
    const porAncora = new Map<string, typeof existentes>();
    for (const l of existentes) porAncora.set(l.passagemAncoraId, [...(porAncora.get(l.passagemAncoraId) ?? []), l]);
    for (const [ancora, r] of res) {
      const ls = porAncora.get(ancora) ?? [];
      const humana = ls.some((l) => l.autorId != null || l.desfeitaPorId != null);
      const autoAtiva = ls.find((l) => l.tipo === "AUTO" && !l.desfeitaEm);
      if (humana) continue; // gente decidiu (ou desfez): o sistema não volta a ligar
      if (r.status === "AUTO" && r.viagemId) {
        if (autoAtiva?.viagemId === r.viagemId) continue;
        if (autoAtiva) await this.prisma.ligacaoTagViagem.delete({ where: { id: autoAtiva.id } });
        await this.prisma.ligacaoTagViagem.create({
          data: { passagemAncoraId: ancora, viagemId: r.viagemId, tipo: "AUTO", motivo: r.candidatas[0]?.razao ?? "ligado pelo sistema" },
        });
      } else if (autoAtiva) {
        // Leitura de sistema que deixou de valer (sem decisão de gente): sai.
        await this.prisma.ligacaoTagViagem.delete({ where: { id: autoAtiva.id } });
      }
    }
  }

  private async gravarTrechos(
    trechos: Trecho[],
    res: Map<string, ResultadoTrecho>,
    entradas: EntradaPlaca[],
    veiculoDaPlaca: Map<string, { id: string }>,
  ) {
    const viDoTrecho = new Map<string, string>();
    for (const e of entradas) for (const v of e.viagens) for (const t of v.trechos) viDoTrecho.set(t.ancoraId, v.ancoraId);
    await this.prisma.$transaction([
      this.prisma.trechoTag.deleteMany({}),
      this.prisma.trechoTag.createMany({
        data: trechos.map((t) => {
          const r = res.get(t.ancoraId)!;
          return {
            placaTexto: t.placa,
            veiculoId: veiculoDaPlaca.get(t.placa)?.id ?? null,
            estado: t.estado,
            ini: new Date(t.ini),
            fim: new Date(t.fim),
            passagemIds: t.passagens.map((p) => p.id),
            passagemAncoraId: t.ancoraId,
            viagemInferidaAncoraId: viDoTrecho.get(t.ancoraId) ?? null,
            valorTag: t.valorTagCent / 100,
            valorVale: t.valorValeCent / 100,
            abriuPor: t.abriuPor,
            cruzamento: {
              status: r.status,
              viagemId: r.viagemId,
              ligariaSozinho: r.ligariaSozinho,
              motivo: r.motivo,
              candidatas: r.candidatas,
              pracas: t.pracas,
            } as unknown as Prisma.InputJsonValue,
          };
        }),
      }),
    ]);
  }

  private async ajustes() {
    const vs = await this.prisma.extratoTagVeiculo.findMany({ where: { extrato: { status: { not: "FALHOU" } } } });
    return vs.map((v) => ({
      extratoId: v.extratoId,
      placa: v.placaTexto,
      diferencaCent: cent(v.ajuste),
      qtdResumo: v.qtdUsos,
      qtdDetalhe: v.qtdDetalhe,
    }));
  }

  private async taxas() {
    const vs = await this.prisma.extratoTagVeiculo.findMany({
      where: { extrato: { status: { not: "FALHOU" } } },
      select: { extratoId: true, taxas: true },
    });
    const porExtrato = new Map<string, Map<string, { descricao: string; valorCent: number; qtd: number }>>();
    for (const v of vs) {
      const m = porExtrato.get(v.extratoId) ?? new Map();
      for (const t of (v.taxas as { descricao: string; valorCent: number }[]) ?? []) {
        const atual = m.get(t.descricao) ?? { descricao: t.descricao, valorCent: 0, qtd: 0 };
        atual.valorCent += t.valorCent;
        atual.qtd += 1;
        m.set(t.descricao, atual);
      }
      porExtrato.set(v.extratoId, m);
    }
    return [...porExtrato.entries()].map(([extratoId, m]) => ({ extratoId, itens: [...m.values()] }));
  }

  private async gravarAchados(achados: ReturnType<typeof calcularAchados>, veiculoDaPlaca: Map<string, { id: string }>) {
    const existentes = await this.prisma.achadoTag.findMany({ select: { id: true, chave: true } });
    const porChave = new Map(existentes.map((a) => [a.chave, a.id]));
    const vistos = new Set<string>();
    for (const a of achados) {
      vistos.add(a.chave);
      const dados = {
        tipo: a.tipo,
        caixa: a.caixa,
        extratoId: a.extratoId,
        placaTexto: a.placa,
        veiculoId: a.placa ? veiculoDaPlaca.get(a.placa)?.id ?? null : null,
        passagemAncoraId: a.ancoraId && !a.ancoraId.includes(":") ? a.ancoraId : a.ancoraId?.split(":")[0] ?? null,
        passagemIds: a.passagemIds,
        valor: a.valorCent == null ? null : a.valorCent / 100,
        titulo: a.titulo,
        explicacao: a.explicacao,
        explicacoes: (a.explicacoes ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        evidencia: (a.evidencia ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        prazoEm: a.prazoEm ? new Date(a.prazoEm) : null,
        vigente: true,
        calculadoEm: new Date(),
      };
      const id = porChave.get(a.chave);
      if (id) await this.prisma.achadoTag.update({ where: { id }, data: dados });
      else await this.prisma.achadoTag.create({ data: { chave: a.chave, ...dados } });
    }
    const sumiram = existentes.filter((a) => !vistos.has(a.chave)).map((a) => a.id);
    if (sumiram.length) await this.prisma.achadoTag.updateMany({ where: { id: { in: sumiram } }, data: { vigente: false } });
  }

  /** As praças (do extrato) na rota de cada viagem, na ordem; null = não sei. */
  async pracasDasViagens(viagemIds: string[]): Promise<Map<string, { chave: string; nome: string }[] | null>> {
    const emOrdem = await this.pedagios.pracasEmOrdemDasViagens(viagemIds);
    const deParas = [
      ...(await this.prisma.pracaTagDeParaConta.findMany({ include: { pedagioRodovia: { select: { lat: true, lng: true } } } })),
      ...(await this.prisma.pracaTagDePara.findMany({
        where: { operadora: OPERADORA },
        include: { pedagioRodovia: { select: { lat: true, lng: true } } },
      })),
    ];
    const out = new Map<string, { chave: string; nome: string }[] | null>();
    for (const [id, lista] of emOrdem) {
      if (!lista) {
        out.set(id, null);
        continue;
      }
      const vistas: { chave: string; nome: string }[] = [];
      for (const p of lista) {
        const d = deParas.find((x) => distanciaMetros(x.pedagioRodovia.lat, x.pedagioRodovia.lng, p.lat, p.lng) < 5000);
        const chave = d?.chavePraca ?? `?${p.id}`;
        if (!vistas.some((v) => v.chave === chave)) vistas.push({ chave, nome: p.nome });
      }
      out.set(id, vistas);
    }
    return out;
  }

  /**
   * A fila "praças a confirmar": o que não casou sozinho, com os candidatos do
   * mapa e a prova do tempo — o intervalo entre passagens seguidas comparado
   * com o tempo de rota de cada candidato (05 §1a, MT-246).
   */
  async filaDePracas() {
    const ps = await this.carregarPassagens();
    const todas = this.pracasDasPassagens(ps);
    const resolvidas = await this.resolverPracas(todas);
    const pendentes = todas.filter((p) => !resolvidas.get(p.chave)!.pedagioRodoviaId);
    if (!pendentes.length) return [];
    const analise = await this.analisarPracas(pendentes, resolvidas, 80);
    const decisao40 = await this.analisarPracas(pendentes, resolvidas);
    const porPlaca = new Map<string, PassagemCarregada[]>();
    for (const p of ps) if (p.dc === "D") porPlaca.set(p.placaTexto, [...(porPlaca.get(p.placaTexto) ?? []), p]);
    const out = [];
    for (const pr of pendentes) {
      const a = analise.get(pr.chave)!;
      // Pares (vizinha resolvida → esta) até 4 h: Δt observado.
      const exemplos: { vizinha: string; observadoMin: number; de: { lat: number; lng: number }; placa: string; quando: string }[] = [];
      for (const lista of porPlaca.values()) {
        for (let i = 0; i < lista.length && exemplos.length < 3; i++) {
          if (lista[i]!.chavePraca !== pr.chave) continue;
          for (const j of [i - 1, i + 1]) {
            const v = lista[j];
            if (!v || v.chavePraca === pr.chave) continue;
            const r = resolvidas.get(v.chavePraca);
            const dt = Math.abs(lista[i]!.ocorridoEm.getTime() - v.ocorridoEm.getTime()) / MIN;
            if (r?.lat == null || dt > 240) continue;
            exemplos.push({ vizinha: `${v.cidade} (${v.rodovia})`, observadoMin: Math.round(dt), de: { lat: r.lat, lng: r.lng! }, placa: v.placaTexto, quando: v.dataHoraTexto });
            break;
          }
        }
      }
      const candidatos = [];
      for (const c of a.candidatos.slice(0, 5)) {
        const tempos = [];
        for (const ex of exemplos) tempos.push({ vizinha: ex.vizinha, observadoMin: ex.observadoMin, rotaMin: (await this.rota(ex.de, c.grupo)).min });
        candidatos.push({
          pedagioRodoviaId: c.grupo.id,
          nome: c.grupo.nome,
          lat: c.grupo.lat,
          lng: c.grupo.lng,
          rodovias: c.grupo.rodovias,
          operadora: c.grupo.operadoras,
          distanciaKm: Math.round(c.distanciaKm),
          tempos: tempos.map((t) => ({ ...t, rotaMin: t.rotaMin == null ? null : Math.round(t.rotaMin) })),
        });
      }
      out.push({
        operadora: OPERADORA,
        chavePraca: pr.chave,
        rodovia: pr.rodovia,
        km: pr.kmMetros / 1000,
        cidade: pr.cidade,
        concessionaria: pr.concessionaria,
        tarifaEixo: pr.tarifaEixoCent == null ? null : pr.tarifaEixoCent / 100,
        passagens: ps.filter((p) => p.chavePraca === pr.chave).length,
        sede: a.sede,
        motivo: decisao40.get(pr.chave)?.decisao.motivo ?? a.decisao.motivo,
        candidatos,
      });
    }
    return out;
  }

  /** Eixos por placa (cadastro, sugestão pela moda) — pra tela dos caminhões. */
  async eixosDasPlacas() {
    const ps = await this.carregarPassagens();
    const porPlaca = new Map<string, number[]>();
    for (const p of ps)
      if (p.tipo === "PEDAGIO" && p.dc === "D" && p.eixosCobrados)
        porPlaca.set(normalizarPlaca(p.placaTexto), [...(porPlaca.get(normalizarPlaca(p.placaTexto)) ?? []), p.eixosCobrados]);
    return new Map(
      [...porPlaca.entries()].map(([placa, eixos]) => {
        const sug = eixosDeCarregado(eixos.map((e) => ({ eixos: e })));
        const vazios = eixos.filter((e) => sug.eixos != null && e < sug.eixos);
        const modaVazio = moda(vazios);
        return [placa, { sugestaoComposicao: sug.eixos, contagem: sug.contagem, modaVazio }];
      }),
    );
  }
}

function moda(xs: number[]): number | null {
  if (!xs.length) return null;
  const c = new Map<number, number>();
  for (const x of xs) c.set(x, (c.get(x) ?? 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]![0];
}

function kmsPorRodovia(ps: { rodovia: string; kmMetros: number }[]) {
  const m = new Map<string, number[]>();
  for (const p of ps) if (p.rodovia.startsWith("BR")) m.set(p.rodovia, [...new Set([...(m.get(p.rodovia) ?? []), p.kmMetros])]);
  return m;
}
