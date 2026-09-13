import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { PrismaService } from "../../prisma/prisma.service";
import { comoSistema } from "../../common/conta/conta-context";
import { STATUS_FORA_FECHAMENTO } from "../../common/viagem-status";
import { resolverRegraMinimo, type RegraMinimoRow } from "../../common/viagem-minimos";
import { calcularValorViagem, type TabelaPrecoRow } from "../../common/viagem-preco";

/**
 * Mantém o `ViagemValor` em dia.
 *
 * POR QUE MATERIALIZAR, já que o projeto aplica mínimos na leitura?
 *
 * Porque dinheiro se soma. O mínimo é aplicado viagem a viagem, na hora de
 * mostrar; o faturamento é `SUM(valorTotal)` de milhares de linhas, por cliente,
 * por mês, no relatório e no dashboard. Recalcular isso em memória a cada
 * abertura de tela é o tipo de coisa que funciona com um cliente e derruba o
 * painel com trinta. O valor mora no banco pra poder ser agregado em SQL.
 *
 * Em compensação, ele tem que ser reconciliado quando qualquer insumo muda: km,
 * toneladas, material, cliente, status, ou a própria tabela de preço. Todo
 * caminho que escreve esses campos chama `recalcular`.
 *
 * O valor alterado à mão NUNCA é sobrescrito por recálculo automático — quem
 * escreveu um motivo decidiu que a regra errou, e um cron não desfaz decisão de
 * gente. Só some se alguém apagar a alteração explicitamente.
 */
@Injectable()
export class PrecificacaoService {
  private readonly log = new Logger(PrecificacaoService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Recalcula uma viagem. Silencioso por natureza: viagem sem tabela que case
   * simplesmente fica sem valor, o que é o estado normal de quem ainda não
   * cadastrou preço nenhum.
   */
  async recalcular(viagemId: string): Promise<{ valor: string | null; motivo?: string }> {
    const viagem = await this.prisma.viagem.findUnique({
      where: { id: viagemId },
      select: {
        id: true,
        status: true,
        data: true,
        km: true,
        toneladas: true,
        valorPedagioTotal: true,
        tipoServicoId: true,
        // Sem este select o mínimo por período volta a valer e a diária fatura
        // tonelada inventada. Mesma pegadinha documentada em viagem-minimos.
        tipoServico: { select: { medicao: true } },
        materialId: true,
        cliente: { select: { empresaId: true } },
        valor: { select: { alteracaoMotivo: true } },
      },
    });
    if (!viagem) return { valor: null, motivo: "VIAGEM_SUMIU" };

    // Alteração manual manda. Ver o comentário da classe.
    if (viagem.valor?.alteracaoMotivo) {
      return { valor: null, motivo: "ALTERADO_A_MAO" };
    }

    const empresaId = viagem.cliente?.empresaId ?? null;
    const [tabelas, regras] = await Promise.all([
      empresaId
        ? this.prisma.tabelaPreco.findMany({ where: { empresaId, ativo: true } })
        : Promise.resolve([]),
      empresaId
        ? this.prisma.regraMinimo.findMany({ where: { empresaId, ativo: true } })
        : Promise.resolve([]),
    ]);

    const minimo =
      empresaId && regras.length > 0
        ? (resolverRegraMinimo(
            regras as unknown as RegraMinimoRow[],
            empresaId,
            viagem.materialId,
            viagem.km ?? 0,
          ) ?? undefined)
        : undefined;

    const r = calcularValorViagem(viagem, {
      empresaId,
      materialId: viagem.materialId,
      tabelas: tabelas as unknown as TabelaPrecoRow[],
      minimo,
    });

    if (!r.valor) {
      // Sem valor agora: apaga o que existia. Uma viagem que voltou pra
      // EM_ANDAMENTO, ou cujo preço foi desativado, não pode manter no banco um
      // número que a regra atual não produz mais — é assim que fica fantasma no
      // relatório.
      await this.prisma.viagemValor.deleteMany({ where: { viagemId } });
      return { valor: null, motivo: r.motivo };
    }

    const v = r.valor;
    await this.prisma.viagemValor.upsert({
      where: { viagemId },
      create: {
        viagemId,
        tabelaPrecoId: v.tabelaPrecoId,
        base: v.base,
        precoUnitario: v.precoUnitario,
        quantidade: v.quantidade,
        valorFrete: v.valorFrete,
        valorPedagio: v.valorPedagio,
        valorTotal: v.valorTotal,
      },
      update: {
        tabelaPrecoId: v.tabelaPrecoId,
        base: v.base,
        precoUnitario: v.precoUnitario,
        quantidade: v.quantidade,
        valorFrete: v.valorFrete,
        valorPedagio: v.valorPedagio,
        valorTotal: v.valorTotal,
        calculadoEm: new Date(),
      },
    });
    return { valor: v.valorTotal };
  }

  /**
   * Recalcula sem nunca derrubar quem chamou.
   *
   * Usado nos caminhos de lançamento do motorista: o app está com o outbox
   * aberto esperando um 2xx, e falhar o lançamento inteiro porque a
   * precificação deu errado seria trocar um problema de escritório por um
   * problema na estrada.
   */
  async recalcularSeguro(viagemId: string): Promise<void> {
    try {
      await this.recalcular(viagemId);
    } catch (e) {
      this.log.error(`falha ao precificar viagem ${viagemId}: ${(e as Error).message}`);
    }
  }

  /**
   * Recalcula em lote — depois de cadastrar ou reajustar um preço, e no backfill
   * de quem já tinha viagens antes da tabela existir.
   *
   * Em série de propósito: é operação de fundo, e a alternativa (paralelo) só
   * serve pra competir com o lançamento de viagem pelo mesmo pool de conexão.
   */
  async recalcularDaEmpresa(
    empresaId: string,
    periodo?: { de?: Date; ate?: Date },
  ): Promise<{ total: number; precificadas: number }> {
    const viagens = await this.prisma.viagem.findMany({
      where: {
        cliente: { empresaId },
        status: { notIn: STATUS_FORA_FECHAMENTO },
        ...(periodo?.de || periodo?.ate
          ? { data: { ...(periodo.de ? { gte: periodo.de } : {}), ...(periodo.ate ? { lte: periodo.ate } : {}) } }
          : {}),
      },
      select: { id: true },
    });

    let precificadas = 0;
    for (const v of viagens) {
      const r = await this.recalcular(v.id);
      if (r.valor) precificadas++;
    }
    this.log.log(
      `recálculo da empresa ${empresaId}: ${precificadas} de ${viagens.length} viagens com valor`,
    );
    return { total: viagens.length, precificadas };
  }

  /**
   * Reconciliação: acha viagem faturável sem valor e precifica.
   *
   * Existe porque há vinte pontos no código que escrevem km, toneladas, material
   * ou status de uma viagem, e depender de todos lembrarem de chamar o recálculo
   * é a mesma armadilha do STATUS_FORA_FECHAMENTO — funciona até o dia em que
   * alguém escreve o vigésimo primeiro. Os caminhos principais chamam direto pro
   * valor aparecer na hora; este cron é a rede embaixo.
   *
   * Só olha o que está SEM valor. Não reprecifica o que já tem: isso mudaria
   * número de mês fechado sozinho, de madrugada, sem ninguém pedir — e é o
   * oposto do que o congelamento existe pra garantir. Reprecificar de propósito
   * é o endpoint de recálculo, com gente apertando o botão.
   *
   * Teto de 500 por rodada: é manutenção, não migração. O backfill de quem tem
   * histórico grande é o endpoint.
   */
  @Cron("0 40 4 * * *", { name: "precificar-pendentes", timeZone: "America/Sao_Paulo" })
  async reconciliarPendentes(): Promise<void> {
    try {
      await comoSistema(async () => {
        const semValor = await this.prisma.viagem.findMany({
          where: {
            status: { notIn: STATUS_FORA_FECHAMENTO },
            valor: { is: null },
            // Só quem tem cliente: a empresa tomadora vem dele, e sem tomador
            // não há de quem cobrar — essas viagens voltariam toda noite pro
            // mesmo lugar sem nunca ganhar valor.
            clienteId: { not: null },
          },
          select: { id: true },
          orderBy: { data: "desc" },
          take: 500,
        });
        if (semValor.length === 0) return;

        let ok = 0;
        for (const v of semValor) {
          const r = await this.recalcular(v.id);
          if (r.valor) ok++;
        }
        // Sobra é esperado e não é erro: são as viagens de empresa que ainda não
        // cadastrou preço. Logamos pra dar pra distinguir "ninguém cadastrou
        // tabela" de "o cálculo parou de funcionar".
        this.log.log(`reconciliação de preço: ${ok} de ${semValor.length} viagens precificadas`);
      });
    } catch (e) {
      this.log.error(`falha na reconciliação de preço: ${(e as Error).message}`);
    }
  }
}
