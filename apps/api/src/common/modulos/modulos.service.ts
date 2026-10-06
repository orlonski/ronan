import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { MODULOS, MODULOS_PADRAO, type ModuloChave } from "@ronan/shared-types";
import { PrismaService } from "../../prisma/prisma.service";
import { modulosDaConta } from "../conta/teto-da-conta";
import { comConta } from "../conta/conta-context";
import { PermissoesService } from "../../admin/permissoes/permissoes.service";
import { semearKitDespesas } from "../despesa-kit";

@Injectable()
export class ModulosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissoes: PermissoesService,
  ) {}

  /** O catálogo + o que esta conta tem. É o que a tela de Empresas mostra. */
  async daConta(contaId: string) {
    // ⚠️ `ModuloContratado` é escopado pela trava: sem o contexto da conta ALVO,
    // a consulta sai filtrada pela conta de QUEM chama (a casa, quando o super
    // administrador não está "assumindo" o cliente) e devolve zero linhas — a
    // tela mostrava todos os módulos da empresa como desligados. Aqui o alvo
    // vem da URL, não da sessão, então o contexto se abre à mão.
    return comConta(contaId, () => this.daContaNoContexto(contaId));
  }

  private async daContaNoContexto(contaId: string) {
    const linhas = await this.prisma.moduloContratado.findMany({
      where: { contaId },
      include: { ligadoPor: { select: { id: true, nome: true } } },
    });
    const ativos = await modulosDaConta(this.prisma, contaId);
    const porChave = new Map(linhas.map((l) => [l.chave, l]));

    return MODULOS.map((def) => {
      const linha = porChave.get(def.chave);
      return {
        ...def,
        contratado: linha?.ativo ?? false,
        /** Contratado e dentro da vigência. É o que o guard usa. */
        vigente: ativos.has(def.chave),
        vigenteDe: linha?.vigenteDe ?? null,
        vigenteAte: linha?.vigenteAte ?? null,
        ligadoPor: linha?.ligadoPor ?? null,
        observacao: linha?.observacao ?? null,
      };
    });
  }

  /**
   * Liga ou desliga um módulo. Quem chama é a PLATAFORMA (tela de Empresas) —
   * o dono da empresa não escolhe o próprio contrato.
   */
  async definir(args: {
    contaId: string;
    chave: ModuloChave;
    ativo: boolean;
    vigenteAte?: string | null;
    observacao?: string | null;
    usuarioId: string;
  }) {
    const def = MODULOS.find((m) => m.chave === args.chave);
    if (!def) throw new NotFoundException("Módulo não encontrado");
    if (def.nucleo && !args.ativo) {
      // Desligar Operação seria vender um sistema de viagens que não registra
      // viagem. A régua comercial pra esse caso é `Conta.ativa`, não módulo.
      throw new NotFoundException(
        `"${def.nome}" é o núcleo do produto e não se desliga. Pra suspender a empresa inteira, use o estado da conta.`,
      );
    }

    // Módulo que depende de outro (Gasto de viagem → Financeiro: o acerto mora
    // lá) só liga com o outro vigente. Desligar o de baixo depois não derruba
    // este: o gasto aprovado fica "aguardando acerto", nunca some.
    if (args.ativo && def.dependeDe?.length) {
      const vigentes = await comConta(args.contaId, () => modulosDaConta(this.prisma, args.contaId));
      const faltam = def.dependeDe.filter((d) => !vigentes.has(d));
      if (faltam.length) {
        const nomes = faltam.map((f) => MODULOS.find((m) => m.chave === f)?.nome ?? f).join(", ");
        throw new ConflictException(
          `"${def.nome}" só funciona com ${nomes} ligado nesta empresa. Ligue ${nomes} antes.`,
        );
      }
    }

    // Mesmo motivo do `daConta`: sem o contexto da conta alvo o upsert gravava o
    // módulo na conta de quem clicou (a casa) e devolvia 200, e a empresa
    // continuava exatamente como estava.
    const linha = await comConta(args.contaId, () =>
      this.prisma.moduloContratado.upsert({
        where: { contaId_chave: { contaId: args.contaId, chave: args.chave } },
        create: {
          contaId: args.contaId,
          chave: args.chave,
          ativo: args.ativo,
          vigenteDe: new Date(),
          vigenteAte: args.vigenteAte ? new Date(`${args.vigenteAte}T00:00:00Z`) : null,
          observacao: args.observacao ?? null,
          ligadoPorId: args.usuarioId,
        },
        update: {
          ativo: args.ativo,
          vigenteAte: args.vigenteAte ? new Date(`${args.vigenteAte}T00:00:00Z`) : null,
          observacao: args.observacao ?? null,
          ligadoPorId: args.usuarioId,
        },
      }),
    );

    // Aplica na hora, como o teto faz (`contas.service.definirTeto`). Sem isto
    // o Administrador da empresa só ganhava as telas do módulo no próximo boot
    // da API: a Schaba ligou o Ponto em 23/09/2026 e ninguém lá tinha nada de
    // ponto. Desligar poda os papéis na hora pelo mesmo caminho.
    await comConta(args.contaId, () => this.permissoes.seedPapeisSistema());
    // Gasto de viagem: o kit de tipos nasce quando o módulo LIGA (idempotente).
    if (args.chave === "despesas" && args.ativo) {
      await comConta(args.contaId, () => semearKitDespesas(this.prisma, args.contaId));
    }
    return linha;
  }

  /**
   * Semeia os módulos de uma conta nova.
   *
   * Idempotente: `skipDuplicates` deixa rodar a cada boot sem reescrever o que a
   * plataforma já configurou à mão. Nunca DESLIGA nada — semear é dar o ponto de
   * partida, não corrigir decisão comercial de ninguém.
   */
  async semearConta(contaId: string, chaves: ModuloChave[] = MODULOS_PADRAO) {
    await this.prisma.moduloContratado.createMany({
      data: chaves.map((chave) => ({
        contaId,
        chave,
        ativo: true,
        vigenteDe: new Date(),
        observacao: "Módulo padrão de conta nova",
      })),
      skipDuplicates: true,
    });
  }
}
