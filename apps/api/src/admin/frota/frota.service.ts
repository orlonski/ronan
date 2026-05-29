import { Injectable, Logger } from "@nestjs/common";
import type { MapaFrotaItem } from "@ronan/shared-types";
import { PrismaService } from "../../prisma/prisma.service";

const RETENCAO_DIAS = 90;

@Injectable()
export class FrotaAdminService {
  private readonly log = new Logger(FrotaAdminService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Retorna a posição mais recente de cada motorista que tem alguma captura
   * dentro da janela informada. Otimizado via DISTINCT ON pra evitar
   * subquery N+1. Postgres-specific (já é nosso DB).
   */
  async mapaFrota(janelaMinutos: number): Promise<MapaFrotaItem[]> {
    const limite = new Date(Date.now() - janelaMinutos * 60_000);

    const rows = await this.prisma.$queryRaw<
      Array<{
        motoristaId: string;
        motoristaNome: string;
        veiculoId: string | null;
        placa: string | null;
        lat: number;
        lng: number;
        precisao: number | null;
        capturadoEm: Date;
      }>
    >`
      SELECT DISTINCT ON (mp."motoristaId")
        mp."motoristaId",
        m.nome AS "motoristaNome",
        v.id   AS "veiculoId",
        v.placa,
        mp.lat,
        mp.lng,
        mp.precisao,
        mp."capturadoEm"
      FROM motorista_posicoes mp
      JOIN motoristas m ON m.id = mp."motoristaId"
      LEFT JOIN veiculos v ON v.id = m."veiculoDefaultId"
      WHERE mp."capturadoEm" >= ${limite}
      ORDER BY mp."motoristaId", mp."capturadoEm" DESC
    `;

    return rows.map((r) => ({
      motorista: {
        id: r.motoristaId,
        nome: r.motoristaNome,
        veiculo:
          r.veiculoId && r.placa
            ? { id: r.veiculoId, placa: r.placa }
            : null,
      },
      ultimaPosicao: {
        lat: r.lat,
        lng: r.lng,
        capturadoEm: r.capturadoEm.toISOString(),
        precisao: r.precisao,
      },
    }));
  }

  /**
   * Expurga posições mais antigas que RETENCAO_DIAS dias. Pode ser chamado
   * via endpoint admin manualmente ou por cron externo (Easypanel).
   * Retorna quantos rows foram apagados.
   */
  async expurgarAntigas(): Promise<{ apagadas: number }> {
    const limite = new Date(Date.now() - RETENCAO_DIAS * 24 * 60 * 60_000);
    const result = await this.prisma.motoristaPosicao.deleteMany({
      where: { capturadoEm: { lt: limite } },
    });
    this.log.log(`Expurgo de posições antigas: ${result.count} removidas`);
    return { apagadas: result.count };
  }
}
