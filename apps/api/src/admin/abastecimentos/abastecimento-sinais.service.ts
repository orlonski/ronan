import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import {
  kmPorLitroDosTrechos,
  sinaisDoAbastecimento,
  type AbastecimentoParaConferir,
  type SinalAbastecimento,
  type TrajetoDoDia,
} from "../../common/abastecimento-conferir";
import { calcularConsumo, type TrechoConsumo } from "../../common/consumo";
import { ymdSaoPaulo } from "../../common/timezone";

/**
 * Busca o que a regra de `common/abastecimento-conferir.ts` precisa, em lote:
 * o histórico de cada caminhão, a capacidade do tanque e o trajeto das viagens
 * do dia. Calculado na leitura, não gravado: o app é offline-first e o
 * abastecimento anterior (que define o trecho) pode chegar dias depois — um
 * carimbo gravado na criação ficaria errado sem ninguém perceber.
 */

/** Quanto voltar no tempo atrás do tanque cheio anterior. Caminhão parado um mês ainda tem trecho. */
const JANELA_HISTORICO_DIAS = 120;

const SELECT_CONFERIR = {
  id: true,
  veiculoId: true,
  data: true,
  tipo: true,
  litros: true,
  valorTotal: true,
  odometro: true,
  tanqueCheio: true,
  emComboio: true,
  lat: true,
  lng: true,
  precisao: true,
  criadoOfflineEm: true,
} as const;

type LinhaBanco = {
  id: string;
  veiculoId: string;
  data: Date;
  tipo: string;
  litros: { toString(): string } | number;
  valorTotal: { toString(): string } | number | null;
  odometro: number | null;
  tanqueCheio: boolean;
  emComboio: boolean;
  lat: number | null;
  lng: number | null;
  precisao: number | null;
  criadoOfflineEm: Date | null;
};

function paraConferir(a: LinhaBanco): AbastecimentoParaConferir & { veiculoId: string } {
  return {
    id: a.id,
    veiculoId: a.veiculoId,
    data: a.data,
    tipo: a.tipo,
    litros: Number(a.litros),
    valorTotal: a.valorTotal != null ? Number(a.valorTotal) : null,
    odometro: a.odometro,
    tanqueCheio: a.tanqueCheio,
    emComboio: a.emComboio,
    lat: a.lat,
    lng: a.lng,
    precisao: a.precisao,
    criadoOfflineEm: a.criadoOfflineEm,
  };
}

const diaSP = (d: Date) => ymdSaoPaulo(d).map((n) => String(n).padStart(2, "0")).join("-");

@Injectable()
export class AbastecimentoSinaisService {
  constructor(private readonly prisma: PrismaService) {}

  /** Os sinais de cada abastecimento pedido, por id. Sem sinal = lista vazia. */
  async calcular(ids: string[]): Promise<Map<string, SinalAbastecimento[]>> {
    const resultado = new Map<string, SinalAbastecimento[]>();
    if (ids.length === 0) return resultado;

    const alvos = (
      await this.prisma.abastecimento.findMany({ where: { id: { in: ids } }, select: SELECT_CONFERIR })
    ).map(paraConferir);
    if (alvos.length === 0) return resultado;

    const veiculoIds = [...new Set(alvos.map((a) => a.veiculoId))];
    const menor = Math.min(...alvos.map((a) => a.data.getTime()));
    const maior = Math.max(...alvos.map((a) => a.data.getTime()));

    const [veiculos, historico, viagens, precos] = await Promise.all([
      this.prisma.veiculo.findMany({
        where: { id: { in: veiculoIds } },
        select: { id: true, capacidadeTanqueLitros: true, metaKmL: true },
      }),
      this.prisma.abastecimento.findMany({
        where: {
          veiculoId: { in: veiculoIds },
          data: { gte: new Date(menor - JANELA_HISTORICO_DIAS * 86_400_000), lte: new Date(maior) },
        },
        select: SELECT_CONFERIR,
      }),
      // Viagem.data é @db.Date: um dia de folga de cada lado cobre a virada de
      // fuso (abastecimento às 22h de Brasília já é dia seguinte em UTC).
      this.prisma.viagem.findMany({
        where: {
          veiculoId: { in: veiculoIds },
          data: { gte: new Date(menor - 86_400_000), lte: new Date(maior + 86_400_000) },
          localCarga: { lat: { not: null }, lng: { not: null } },
          localDescarga: { lat: { not: null }, lng: { not: null } },
        },
        select: {
          veiculoId: true,
          data: true,
          localCarga: { select: { lat: true, lng: true } },
          localDescarga: { select: { lat: true, lng: true } },
        },
      }),
      // Preço "normal": todos os abastecimentos COM valor da frota nos 30 dias
      // anteriores a cada um (comboio não tem valor e fica de fora sozinho).
      this.prisma.abastecimento.findMany({
        where: {
          data: { gte: new Date(menor - 30 * 86_400_000), lte: new Date(maior) },
          valorTotal: { not: null },
        },
        select: { tipo: true, data: true, litros: true, valorTotal: true },
      }),
    ]);
    const precosPorTipo = new Map<string, { t: number; p: number }[]>();
    for (const x of precos) {
      const litros = Number(x.litros);
      if (litros <= 0 || x.valorTotal == null) continue;
      const lista = precosPorTipo.get(x.tipo) ?? [];
      lista.push({ t: x.data.getTime(), p: Number(x.valorTotal) / litros });
      precosPorTipo.set(x.tipo, lista);
    }
    /** Mediana do preço/litro do tipo nos 30 dias antes (sem contar o próprio). Precisa de 5 pra valer. */
    const precoReferencia = (a: AbastecimentoParaConferir): number | null => {
      const t = a.data.getTime();
      const vs = (precosPorTipo.get(a.tipo) ?? [])
        .filter((x) => x.t < t && x.t >= t - 30 * 86_400_000)
        .map((x) => x.p)
        .sort((x, y) => x - y);
      if (vs.length < 5) return null;
      const meio = Math.floor(vs.length / 2);
      return vs.length % 2 ? vs[meio]! : (vs[meio - 1]! + vs[meio]!) / 2;
    };

    const capacidade = new Map(veiculos.map((v) => [v.id, v.capacidadeTanqueLitros]));
    const metas = new Map(veiculos.map((v) => [v.id, v.metaKmL != null ? Number(v.metaKmL) : null]));

    const historicoPor = new Map<string, AbastecimentoParaConferir[]>();
    for (const linha of historico) {
      const a = paraConferir(linha);
      const lista = historicoPor.get(a.veiculoId) ?? [];
      lista.push(a);
      historicoPor.set(a.veiculoId, lista);
    }

    // Régua da frota: os trechos de todos os caminhões olhados, ponderados pelo
    // km. Só entra quando o caminhão não tem trechos dele o bastante.
    const trechosFrota: TrechoConsumo[] = [];
    for (const lista of historicoPor.values()) {
      trechosFrota.push(
        ...calcularConsumo(
          lista
            .filter((a) => a.tipo !== "ARLA_32")
            .map((a) => ({
              id: a.id,
              data: a.data,
              odometro: a.odometro,
              litros: a.litros,
              tanqueCheio: a.tanqueCheio,
              emComboio: a.emComboio,
            })),
        ).trechos,
      );
    }
    const kmPorLitroFrota = kmPorLitroDosTrechos(trechosFrota);

    // Viagem.data é o dia civil (meia-noite UTC), então a chave é o próprio ISO.
    const trajetos = new Map<string, TrajetoDoDia[]>();
    for (const v of viagens) {
      if (!v.data || !v.localCarga || !v.localDescarga) continue;
      const chave = `${v.veiculoId}|${v.data.toISOString().slice(0, 10)}`;
      const lista = trajetos.get(chave) ?? [];
      lista.push({
        cargaLat: v.localCarga.lat!,
        cargaLng: v.localCarga.lng!,
        descargaLat: v.localDescarga.lat!,
        descargaLng: v.localDescarga.lng!,
      });
      trajetos.set(chave, lista);
    }

    for (const alvo of alvos) {
      resultado.set(
        alvo.id,
        sinaisDoAbastecimento({
          alvo,
          historico: historicoPor.get(alvo.veiculoId) ?? [alvo],
          capacidadeTanqueLitros: capacidade.get(alvo.veiculoId) ?? null,
          kmPorLitroFrota,
          trajetosDoDia: trajetos.get(`${alvo.veiculoId}|${diaSP(alvo.data)}`) ?? [],
          metaKmL: metas.get(alvo.veiculoId) ?? null,
          precoReferencia: precoReferencia(alvo),
        }),
      );
    }
    return resultado;
  }
}
