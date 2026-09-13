import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import type { MapaFrotaItem } from "@ronan/shared-types";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import type { EscopoAdmin } from "../../common/escopo/escopo";
import { contaIdAtual, comoSistema } from "../../common/conta/conta-context";

const RETENCAO_DIAS = 90;

@Injectable()
export class FrotaAdminService {
  private readonly log = new Logger(FrotaAdminService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Retorna a posição mais recente de cada motorista que tem contato recente:
   * capturado OU recebido dentro da janela informada. O OR com `recebidoEm`
   * cobre dois casos reais: (1) atraso de sync — o batch chega minutos depois
   * da captura; (2) celular com relógio/fuso torto — o `capturadoEm` sai
   * defasado, mas `recebidoEm` (hora do servidor) é a verdade de "ouvimos
   * dele agora". Sem isso, motorista ativo some dos filtros curtos.
   * Otimizado via DISTINCT ON pra evitar subquery N+1. Postgres-specific.
   */
  async mapaFrota(janelaMinutos: number, escopo: EscopoAdmin): Promise<MapaFrotaItem[]> {
    const limite = new Date(Date.now() - janelaMinutos * 60_000);
    // SQL cru não passa por helper de escopo: o filtro entra na cláusula. Como
    // posição não carrega carimbo, recorta pela frota atual do motorista.
    const filtroFrota = escopo
      ? Prisma.sql`AND m."transportadoraId" = ANY(${escopo.transportadoraIds}::text[])`
      : Prisma.empty;

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
      WHERE mp."contaId" = ${contaIdAtual()}
        AND (mp."capturadoEm" >= ${limite} OR mp."recebidoEm" >= ${limite})
      ${filtroFrota}
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
   *
   * Chamado de dentro de uma requisição, a trava de conta recorta o deleteMany
   * pra conta do usuário — é o certo: o admin de uma empresa não apaga o
   * histórico da outra. Quem varre tudo é o cron abaixo, em `comoSistema`.
   */
  async expurgarAntigas(): Promise<{ apagadas: number }> {
    const limite = new Date(Date.now() - RETENCAO_DIAS * 24 * 60 * 60_000);
    const result = await this.prisma.motoristaPosicao.deleteMany({
      where: { capturadoEm: { lt: limite } },
    });
    this.log.log(`Expurgo de posições antigas: ${result.count} removidas`);
    return { apagadas: result.count };
  }

  /**
   * O expurgo automático. Existia só como botão no painel e como promessa de
   * "cron externo (Easypanel)" que nunca foi criado — na prática as posições
   * NUNCA eram apagadas, e é a tabela que mais cresce do sistema (um ponto por
   * motorista a cada ~15 min, o dia inteiro). A retenção de 90 dias está na
   * política de privacidade; sem este cron ela era só texto.
   *
   * Roda de madrugada, uma vez por dia, fora do horário de operação: é um
   * DELETE grande e não deve competir com o lançamento de viagem.
   *
   * `comoSistema` porque o expurgo é por data e vale pra todas as contas —
   * é a mesma justificativa do limpador de stories.
   */
  @Cron("0 20 3 * * *", { name: "expurgar-posicoes", timeZone: "America/Sao_Paulo" })
  async expurgarAntigasCron(): Promise<void> {
    try {
      await comoSistema(() => this.expurgarAntigas());
    } catch (e) {
      // Cron não pode derrubar o processo: loga e tenta de novo amanhã.
      this.log.error(`falha no expurgo de posições: ${(e as Error).message}`);
    }
  }
}
