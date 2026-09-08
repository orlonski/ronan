import { Injectable, NotFoundException } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import type { EstimativaFrete, ComprovantePessoalPublico } from "@ronan/shared-types";
import { comoSistema } from "../common/conta/conta-context";
import { PrismaService } from "../prisma/prisma.service";
import { RoteamentoService } from "../roteamento/roteamento.service";
import { PedagiosRodoviaConsultaService } from "../admin/pedagios-rodovia/pedagios-rodovia-consulta.service";

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
  ) {}

  async estimar(
    identidadeId: string,
    origem: { lat: number; lng: number },
    destino: { lat: number; lng: number },
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
      };
    }

    const km = Number(rota.km);
    // `null` (não sei) é diferente de `[]` (checei e não passa por praça): sem
    // geometria a tela não pode afirmar "sem pedágio no caminho".
    const praças = rota.geometria ? await this.pedagios.pedagiosNaGeometria(rota.geometria) : null;
    const dele = await this.numerosDele(identidadeId);

    return {
      km,
      duracaoMinutos: Math.round(rota.duracaoSegundos / 60),
      geometria: rota.geometria,
      pedagios: praças ?? [],
      pedagiosDesconhecidos: praças === null,
      ...dele,
      // Só estima o diesel com os DOIS números dele. Chutar consumo médio de
      // caminhão daria um número plausível e errado — e é dinheiro do cara.
      diesel:
        dele.consumoKmPorLitro && dele.precoLitro
          ? arredondar((km / dele.consumoKmPorLitro) * dele.precoLitro)
          : null,
    };
  }

  /**
   * O consumo e o preço do litro DELE, dos últimos 90 dias.
   *
   * Consumo = km rodado nas viagens dele ÷ litros abastecidos. Só sai quando os
   * dois lados existem; sem isso a estimativa de diesel fica `null` e a tela diz
   * o que falta lançar, em vez de inventar uma média de mercado.
   */
  private async numerosDele(identidadeId: string): Promise<{
    consumoKmPorLitro: number | null;
    precoLitro: number | null;
  }> {
    const desde = new Date(Date.now() - DIAS_HISTORICO * 24 * 60 * 60 * 1000);

    const [abastecimentos, viagens] = await comoSistema(() =>
      Promise.all([
        this.prisma.lancamentoPessoal.aggregate({
          where: { identidadeId, tipo: "ABASTECIMENTO", data: { gte: desde } },
          _sum: { litros: true, valor: true },
        }),
        this.prisma.viagemPessoal.aggregate({
          where: { identidadeId, data: { gte: desde } },
          _sum: { km: true },
        }),
      ]),
    );

    const litros = Number(abastecimentos._sum.litros ?? 0);
    const gasto = Number(abastecimentos._sum.valor ?? 0);
    const km = Number(viagens._sum.km ?? 0);

    return {
      consumoKmPorLitro: litros > 0 && km > 0 ? arredondar(km / litros) : null,
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
  ) {
    const criado = await comoSistema(() =>
      this.prisma.comprovantePessoal.create({
        data: {
          identidadeId,
          token: randomBytes(16).toString("base64url"),
          inicio: new Date(`${inicio}T00:00:00.000Z`),
          fim: new Date(`${fim}T00:00:00.000Z`),
          destinatario: destinatario ?? null,
        },
        select: { token: true, inicio: true, fim: true, destinatario: true, criadoEm: true },
      }),
    );
    return {
      token: criado.token,
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
  async comprovantePublico(token: string): Promise<ComprovantePessoalPublico> {
    const comprovante = await comoSistema(() =>
      this.prisma.comprovantePessoal.findUnique({
        where: { token },
        select: {
          identidadeId: true,
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
