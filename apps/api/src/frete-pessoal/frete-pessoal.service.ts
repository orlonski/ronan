import { Injectable, NotFoundException } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import type {
  CadastroPessoalPublico,
  ComprovantePessoalPublico,
  EstimativaFrete,
} from "@ronan/shared-types";
import { comoSistema } from "../common/conta/conta-context";
import { PrismaService } from "../prisma/prisma.service";
import { RoteamentoService } from "../roteamento/roteamento.service";
import { PedagiosRodoviaConsultaService } from "../admin/pedagios-rodovia/pedagios-rodovia-consulta.service";
import { DocumentosPessoaisService } from "./documentos-pessoais.service";
import { calcularConsumo, type ConsumoVeiculo } from "../common/consumo";
import {
  compararComHistorico,
  custoPorKmDele,
  pedagioDaRota,
  resultadoDoFrete,
} from "../common/frete-autonomo";

/** Janela do histórico que alimenta consumo e preço do litro. */
const DIAS_HISTORICO = 90;

/**
 * "Vale a pena esse frete?" — e o comprovante do que ele já rodou.
 *
 * É a conta que o autônomo faz no papel antes de aceitar uma carga: quanto vou
 * rodar, quanto de pedágio, quanto de diesel, sobra quanto. Aqui ela sai com os
 * números DELE — o consumo e o preço do litro vêm do que ele mesmo lançou.
 *
 * Tudo montado em cima do que já existe e não pertence a empresa nenhuma:
 * `GeocodingCache` e `PedagioRodovia` já são tabelas globais, e o OSRM já
 * calculava por coordenada. Nenhum catálogo de empresa entra aqui.
 */
@Injectable()
export class FretePessoalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly roteamento: RoteamentoService,
    private readonly pedagios: PedagiosRodoviaConsultaService,
    private readonly documentos: DocumentosPessoaisService,
  ) {}

  async estimar(
    identidadeId: string,
    origem: { lat: number; lng: number },
    destino: { lat: number; lng: number },
    // Os nomes que ele digitou. Só servem pra achar o mesmo trecho no histórico
    // dele — coordenada não casa com coordenada digitada de novo.
    nomes?: { origem?: string; destino?: string; valorFrete?: number },
  ): Promise<EstimativaFrete> {
    const rota = await this.roteamento.calcularEntreCoordenadas(origem, destino);
    // `== null` e não `=== null`: o contrato do roteamento é devolver `km: null`
    // com o erro, mas um `undefined` que escapasse viraria `Number(undefined)`
    // = NaN e a tela mostraria "NaN km" como se fosse conta.
    if (rota.km == null) {
      return {
        km: null,
        erro: rota.erro,
        pedagios: [],
        // Sem rota não dá pra estimar nada — mas os números dele continuam
        // valendo, e a tela usa pra explicar o que teria sido usado.
        ...(await this.numerosDele(identidadeId)),
        diesel: null,
        pedagioTotal: null,
        pedagioParcial: false,
        custoPorKm: null,
        historico: null,
        resultado: null,
      };
    }

    const km = Number(rota.km);
    // `null` (não sei) é diferente de `[]` (checei e não passa por praça): sem
    // geometria a tela não pode afirmar "sem pedágio no caminho".
    const praças = rota.geometria ? await this.pedagios.pedagiosNaGeometria(rota.geometria) : null;
    const [dele, eixos, custo, historico] = await Promise.all([
      this.numerosDele(identidadeId),
      this.eixosDele(identidadeId),
      this.custoDele(identidadeId),
      nomes?.origem && nomes?.destino
        ? this.historicoDoTrecho(identidadeId, nomes.origem, nomes.destino)
        : Promise.resolve(null),
    ]);

    const diesel =
      dele.consumoKmPorLitro && dele.precoLitro
        ? arredondar((km / dele.consumoKmPorLitro) * dele.precoLitro)
        : null;

    const pedagio = pedagioDaRota(praças ?? [], eixos);

    return {
      km,
      duracaoMinutos: Math.round(rota.duracaoSegundos / 60),
      geometria: rota.geometria,
      pedagios: praças ?? [],
      pedagiosDesconhecidos: praças === null,
      ...dele,
      // Só estima o diesel com os DOIS números dele. Chutar consumo médio de
      // caminhão daria um número plausível e errado — e é dinheiro do cara.
      diesel,
      pedagioTotal: pedagio.total,
      // `true` = tem praça na rota sem preço cadastrado, então o total é um
      // PISO. Dizer isso é o que impede o frete de parecer melhor do que é.
      pedagioParcial: pedagio.semTarifa > 0,
      custoPorKm: custo.valor,
      historico,
      // A pergunta não é "quanto é o frete", é "sobra quanto". Só responde
      // quando ele disse o valor que estão oferecendo.
      resultado:
        nomes?.valorFrete != null && nomes.valorFrete > 0
          ? resultadoDoFrete({
              valorFrete: nomes.valorFrete,
              km,
              diesel,
              pedagio: pedagio.total,
              custoPorKm: custo.valor,
            })
          : null,
    };
  }

  private async eixosDele(identidadeId: string): Promise<number | null> {
    const eu = await comoSistema(() =>
      this.prisma.motoristaIdentidade.findUnique({
        where: { id: identidadeId },
        select: { eixos: true },
      }),
    );
    return eu?.eixos ?? null;
  }

  /**
   * O que o caminhão custa por km rodado, fora combustível.
   *
   * O diesel fica de fora porque é estimado à parte, pelo consumo medido —
   * somar os dois contaria diesel duas vezes, e um frete bom viraria recusado.
   */
  private async custoDele(identidadeId: string) {
    const desde = new Date(Date.now() - DIAS_HISTORICO * 24 * 60 * 60 * 1000);
    const [gastos, viagens] = await comoSistema(() =>
      Promise.all([
        this.prisma.lancamentoPessoal.aggregate({
          where: {
            identidadeId,
            data: { gte: desde },
            tipo: { in: ["MANUTENCAO", "ALIMENTACAO", "OUTRO_GASTO"] },
          },
          _sum: { valor: true },
        }),
        this.prisma.viagemPessoal.aggregate({
          where: { identidadeId, data: { gte: desde } },
          _sum: { km: true },
        }),
      ]),
    );
    return custoPorKmDele({
      gastosNaoCombustivel: Number(gastos._sum.valor ?? 0),
      kmRodado: Number(viagens._sum.km ?? 0),
      dias: DIAS_HISTORICO,
    });
  }

  /**
   * "Esse trecho você já fez, por quanto."
   *
   * A única referência de preço honesta que dá pra oferecer: a dele. Tabela de
   * mercado o sistema não conhece, e inventar uma seria colocar um número na
   * boca dele no meio de uma negociação.
   */
  private async historicoDoTrecho(identidadeId: string, origem: string, destino: string) {
    const anteriores = await comoSistema(() =>
      this.prisma.viagemPessoal.findMany({
        where: { identidadeId, valorRecebido: { not: null } },
        select: { origem: true, destino: true, data: true, km: true, valorRecebido: true },
        orderBy: { data: "desc" },
        take: 300,
      }),
    );
    const r = compararComHistorico(
      origem,
      destino,
      anteriores.map((v) => ({
        origem: v.origem,
        destino: v.destino,
        data: v.data,
        km: v.km == null ? null : Number(v.km),
        valorRecebido: v.valorRecebido == null ? null : Number(v.valorRecebido),
      })),
    );
    return r.vezes === 0
      ? null
      : {
          vezes: r.vezes,
          medianaValor: r.medianaValor,
          medianaPorKm: r.medianaPorKm,
          ultimaVez: r.ultimaVez ? r.ultimaVez.toISOString().slice(0, 10) : null,
        };
  }

  /**
   * O consumo e o preço do litro DELE, dos últimos 90 dias.
   *
   * O consumo sai TANQUE-A-TANQUE, pelo odômetro, e não da divisão do km das
   * viagens lançadas pelos litros abastecidos. Aquela conta juntava dois
   * conjuntos que não se falam: quem lança cinco fretes e abastece vinte vezes
   * recebia um km/l inventado com cara de medido — e é com esse número que ele
   * decide se aceita o frete.
   *
   * Sem dois cheios com odômetro, devolve `null` e diz o que falta. A tela
   * mostra o que preencher em vez de uma média de mercado disfarçada de "seu
   * consumo".
   */
  private async numerosDele(identidadeId: string): Promise<{
    consumoKmPorLitro: number | null;
    /** Por que não deu pra medir — vira o texto que pede o dado que falta. */
    consumoMotivo: ConsumoVeiculo["motivo"] | null;
    precoLitro: number | null;
  }> {
    const desde = new Date(Date.now() - DIAS_HISTORICO * 24 * 60 * 60 * 1000);

    const abastecimentos = await comoSistema(() =>
      this.prisma.lancamentoPessoal.findMany({
        where: { identidadeId, tipo: "ABASTECIMENTO", data: { gte: desde } },
        select: {
          id: true,
          data: true,
          odometro: true,
          litros: true,
          valor: true,
          tanqueCheio: true,
        },
        orderBy: { data: "asc" },
      }),
    );

    const consumo = calcularConsumo(
      abastecimentos.map((a) => ({
        id: a.id,
        data: a.data,
        odometro: a.odometro,
        litros: Number(a.litros ?? 0),
        tanqueCheio: a.tanqueCheio,
      })),
    );

    // O preço do litro segue vindo do total: aqui a divisão é legítima, os dois
    // números saem do MESMO abastecimento.
    let litros = 0;
    let gasto = 0;
    for (const a of abastecimentos) {
      const l = Number(a.litros ?? 0);
      if (l <= 0) continue;
      litros += l;
      gasto += Number(a.valor);
    }

    return {
      consumoKmPorLitro: consumo.kmPorLitro != null ? arredondar(consumo.kmPorLitro) : null,
      consumoMotivo: consumo.kmPorLitro != null ? null : (consumo.motivo ?? "SEM_DOIS_CHEIOS"),
      precoLitro: litros > 0 && gasto > 0 ? arredondar(gasto / litros) : null,
    };
  }

  // ---- Comprovante pra quem vai pagar ----

  /**
   * Cria o link do período. Token em claro de propósito: quem recebe não tem
   * cadastro em lugar nenhum, e o link é o que ele consegue abrir. Revogável.
   */
  async criarComprovante(
    identidadeId: string,
    inicio: string,
    fim: string,
    destinatario?: string,
    tipo: "FRETES" | "CADASTRO" = "FRETES",
  ) {
    const criado = await comoSistema(() =>
      this.prisma.comprovantePessoal.create({
        data: {
          identidadeId,
          tipo,
          token: randomBytes(16).toString("base64url"),
          inicio: new Date(`${inicio}T00:00:00.000Z`),
          fim: new Date(`${fim}T00:00:00.000Z`),
          destinatario: destinatario ?? null,
        },
        select: { token: true, tipo: true, inicio: true, fim: true, destinatario: true },
      }),
    );
    return {
      token: criado.token,
      tipo: criado.tipo,
      inicio: criado.inicio.toISOString().slice(0, 10),
      fim: criado.fim.toISOString().slice(0, 10),
      destinatario: criado.destinatario,
    };
  }

  /** Revoga um comprovante dele. Nunca o de outra pessoa. */
  async revogarComprovante(identidadeId: string, token: string) {
    const r = await comoSistema(() =>
      this.prisma.comprovantePessoal.updateMany({
        where: { token, identidadeId, revogadoEm: null },
        data: { revogadoEm: new Date() },
      }),
    );
    if (r.count === 0) throw new NotFoundException("Comprovante não encontrado.");
    return { ok: true as const };
  }

  /**
   * A página pública do comprovante.
   *
   * Rota sem token de sessão — então **não pode tocar em nada de empresa**: um
   * `@Public` que lê dado de negócio quebra por falta de conta no contexto (já
   * aconteceu neste repo). Aqui tudo é da pessoa, e o que sai é montado campo a
   * campo: o nome dela, o período, e os fretes. Nada de CPF, telefone, gasto ou
   * qualquer empresa em que ela rode.
   */
  async comprovantePublico(
    token: string,
  ): Promise<ComprovantePessoalPublico | CadastroPessoalPublico> {
    const comprovante = await comoSistema(() =>
      this.prisma.comprovantePessoal.findUnique({
        where: { token },
        select: {
          identidadeId: true,
          tipo: true,
          inicio: true,
          fim: true,
          destinatario: true,
          revogadoEm: true,
          identidade: { select: { nome: true } },
        },
      }),
    );
    // Mesma resposta pra link inexistente e revogado: quem tem um link velho não
    // descobre se ele já existiu.
    if (!comprovante || comprovante.revogadoEm) {
      throw new NotFoundException("Esse comprovante não está mais disponível.");
    }

    // O mesmo link serve a dois conteúdos: o que ele rodou, e quem ele é.
    if (comprovante.tipo === "CADASTRO") {
      return this.documentos.cadastroPublico(
        comprovante.identidadeId,
        comprovante.identidade.nome,
        comprovante.destinatario,
      );
    }

    const viagens = await comoSistema(() =>
      this.prisma.viagemPessoal.findMany({
        where: {
          identidadeId: comprovante.identidadeId,
          data: { gte: comprovante.inicio, lte: comprovante.fim },
        },
        orderBy: { data: "asc" },
        select: {
          data: true,
          origem: true,
          destino: true,
          carga: true,
          km: true,
          peso: true,
          valorRecebido: true,
        },
      }),
    );

    return {
      motorista: comprovante.identidade.nome,
      destinatario: comprovante.destinatario,
      inicio: comprovante.inicio.toISOString().slice(0, 10),
      fim: comprovante.fim.toISOString().slice(0, 10),
      viagens: viagens.map((v) => ({
        data: v.data.toISOString().slice(0, 10),
        origem: v.origem,
        destino: v.destino,
        carga: v.carga,
        km: v.km === null ? null : Number(v.km),
        peso: v.peso === null ? null : Number(v.peso),
        valorRecebido: v.valorRecebido === null ? null : Number(v.valorRecebido),
      })),
      totalKm: arredondar(viagens.reduce((s, v) => s + Number(v.km ?? 0), 0)),
      totalRecebido: arredondar(viagens.reduce((s, v) => s + Number(v.valorRecebido ?? 0), 0)),
    };
  }
}

/** Centavos, não dízima. */
function arredondar(n: number): number {
  return Math.round(n * 100) / 100;
}
