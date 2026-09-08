import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  CriarLancamentoPessoalInput,
  LancamentoPessoal,
  ResumoMesPessoal,
  TipoLancamentoPessoal,
} from "@ronan/shared-types";
import { ehGanho, TIPOS_LANCAMENTO_PESSOAL } from "@ronan/shared-types";
import { comoSistema } from "../common/conta/conta-context";
import { PrismaService } from "../prisma/prisma.service";

/**
 * O caderninho do motorista: o que ele gastou e recebeu, do bolso dele.
 *
 * **A trava de conta não protege nada aqui** — `LancamentoPessoal` é global de
 * propósito, porque pertence à PESSOA e não a uma empresa. O isolamento é este
 * serviço: TODA consulta leva `identidadeId`, que vem do token e nunca do corpo
 * da request. É a mesma classe de cuidado do SQL cru, e a mesma classe de erro
 * se alguém escrever um `findMany` sem ele.
 *
 * Nenhuma empresa lê isto. Não há endpoint de admin, não entra em relatório, não
 * vai pro fechamento — quando ele for vinculado a uma transportadora, o que é
 * dele continua dele.
 */
@Injectable()
export class LancamentosPessoaisService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Cria (ou reencontra) um lançamento.
   *
   * Idempotente pelo `clientId`: o app é offline-first e reenvia o mesmo item
   * quando a rede cai no meio. Reenvio devolve o que já está lá em vez de
   * duplicar o gasto — e devolver 200 é o que tira o item da fila do aparelho.
   */
  async criar(
    identidadeId: string,
    input: CriarLancamentoPessoalInput,
  ): Promise<LancamentoPessoal> {
    // A busca já leva a pessoa: o `clientId` é único DENTRO do caderninho dela,
    // então nem existe a chance de devolver (ou esbarrar em) o lançamento de
    // outra pessoa que tenha gerado o mesmo id.
    const existente = await comoSistema(() =>
      this.prisma.lancamentoPessoal.findUnique({
        where: { identidadeId_clientId: { identidadeId, clientId: input.clientId } },
      }),
    );
    if (existente) return saida(existente);

    const criado = await comoSistema(() =>
      this.prisma.lancamentoPessoal.create({
        data: {
          identidadeId,
          clientId: input.clientId,
          tipo: input.tipo,
          data: new Date(`${input.data}T00:00:00.000Z`),
          valor: new Prisma.Decimal(input.valor),
          litros: input.litros === undefined ? null : new Prisma.Decimal(input.litros),
          odometro: input.odometro ?? null,
          descricao: input.descricao ?? null,
        },
      }),
    );
    return saida(criado);
  }

  /** Os lançamentos de um mês (YYYY-MM), do mais recente pro mais antigo. */
  async listar(identidadeId: string, mes: string): Promise<LancamentoPessoal[]> {
    const { inicio, fim } = faixaDoMes(mes);
    const itens = await comoSistema(() =>
      this.prisma.lancamentoPessoal.findMany({
        where: { identidadeId, data: { gte: inicio, lt: fim } },
        orderBy: [{ data: "desc" }, { criadoEm: "desc" }],
      }),
    );
    return itens.map(saida);
  }

  async resumo(identidadeId: string, mes: string): Promise<ResumoMesPessoal> {
    const itens = await this.listar(identidadeId, mes);
    let ganhos = 0;
    let gastos = 0;
    let litros = 0;
    let gastoAbastecimento = 0;
    const porTipo = new Map<TipoLancamentoPessoal, { total: number; quantidade: number }>();

    for (const i of itens) {
      if (ehGanho(i.tipo)) ganhos += i.valor;
      else gastos += i.valor;
      if (i.tipo === "ABASTECIMENTO" && i.litros) {
        litros += i.litros;
        gastoAbastecimento += i.valor;
      }
      const atual = porTipo.get(i.tipo) ?? { total: 0, quantidade: 0 };
      porTipo.set(i.tipo, { total: atual.total + i.valor, quantidade: atual.quantidade + 1 });
    }

    return {
      mes,
      ganhos: arredondar(ganhos),
      gastos: arredondar(gastos),
      saldo: arredondar(ganhos - gastos),
      litros: arredondar(litros),
      // Só com litro informado — sem isso a média viraria o preço de um tanque
      // dividido por zero, ou pior, um número que parece certo e não é.
      precoMedioLitro: litros > 0 ? arredondar(gastoAbastecimento / litros) : null,
      porTipo: TIPOS_LANCAMENTO_PESSOAL.filter((t) => porTipo.has(t)).map((t) => ({
        tipo: t,
        total: arredondar(porTipo.get(t)!.total),
        quantidade: porTipo.get(t)!.quantidade,
      })),
    };
  }

  /** Apaga um lançamento dele. Nunca o de outra pessoa. */
  async apagar(identidadeId: string, id: string): Promise<{ ok: true }> {
    const apagados = await comoSistema(() =>
      this.prisma.lancamentoPessoal.deleteMany({ where: { id, identidadeId } }),
    );
    // Mesma resposta pra "não existe" e "é de outro": quem chutar id não
    // descobre nem que ele existe.
    if (apagados.count === 0) throw new NotFoundException("Lançamento não encontrado.");
    return { ok: true };
  }
}

type LinhaPrisma = {
  id: string;
  clientId: string;
  tipo: TipoLancamentoPessoal;
  data: Date;
  valor: Prisma.Decimal;
  litros: Prisma.Decimal | null;
  odometro: number | null;
  descricao: string | null;
  criadoEm: Date;
};

/**
 * O que sai pra fora, campo a campo.
 *
 * `identidadeId` NÃO sai: o app já sabe de quem é (é dele), e o que não precisa
 * atravessar a fronteira não atravessa. Decimal vira número — o app faz conta,
 * e string de decimal em JS vira bug de soma.
 */
function saida(l: LinhaPrisma): LancamentoPessoal {
  return {
    id: l.id,
    clientId: l.clientId,
    tipo: l.tipo,
    data: l.data.toISOString().slice(0, 10),
    valor: Number(l.valor),
    litros: l.litros === null ? null : Number(l.litros),
    odometro: l.odometro,
    descricao: l.descricao,
    criadoEm: l.criadoEm.toISOString(),
  };
}

/**
 * Começo e fim de um mês YYYY-MM.
 *
 * A coluna é `@db.Date` (dia civil, sem hora), então a faixa é montada em UTC de
 * propósito: aqui não há instante nenhum pra converter, e ancorar em São Paulo
 * um valor que já é "dia" só deslocaria a borda em 3 horas — fazendo o dia 1º
 * cair no mês anterior.
 */
function faixaDoMes(mes: string): { inicio: Date; fim: Date } {
  const [ano, m] = mes.split("-").map(Number);
  const inicio = new Date(Date.UTC(ano!, m! - 1, 1));
  const fim = new Date(Date.UTC(ano!, m!, 1));
  return { inicio, fim };
}

/** Centavos, não dízima: soma de float em dinheiro sempre vaza no fim. */
function arredondar(n: number): number {
  return Math.round(n * 100) / 100;
}
