import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import {
  ACESSOS_APP_CHAVES,
  type AcessosApp,
  type SalvarPerfilAcessoInput,
} from "@ronan/shared-types";
import { PrismaService } from "../../prisma/prisma.service";

/**
 * OS PERFIS DE ACESSO DO APP.
 *
 * ⚠️ O perfil é MOLDE, não fonte. Atribuir ou editar ESCREVE as colunas `pode*`
 * do motorista; nada no sistema lê "o perfil" pra decidir se alguém pode algo.
 *
 * Foi decisão, e o motivo é concreto: `podeChat` entra em cláusula WHERE do
 * Prisma (a lista de contatos do chat filtra por ele), e valor calculado em
 * tempo de leitura não vai pra dentro de um WHERE. Resolver no read obrigaria
 * a filtrar em memória em todo lugar que hoje filtra no banco — muito risco
 * pra ganhar elegância. Materializar é o mesmo desenho do `ViagemValor`, e
 * pelo mesmo motivo: o valor tem que estar lá quando alguém for somar.
 *
 * A consequência boa: NADA no app nem nos guards precisou mudar. A
 * consequência a assumir: editar um perfil é uma escrita em massa, e ela
 * carimba auditoria.
 */
@Injectable()
export class PerfisAcessoService {
  constructor(private readonly prisma: PrismaService) {}

  private acessosDe(o: Record<string, unknown>): AcessosApp {
    return Object.fromEntries(
      ACESSOS_APP_CHAVES.map((c) => [c, o[c] === true]),
    ) as AcessosApp;
  }

  async listar() {
    const perfis = await this.prisma.perfilAcessoApp.findMany({
      orderBy: [{ ativo: "desc" }, { nome: "asc" }],
      include: { _count: { select: { motoristas: true } } },
    });
    return perfis.map((p) => ({
      id: p.id,
      nome: p.nome,
      descricao: p.descricao,
      ativo: p.ativo,
      sugeridoPara: p.sugeridoPara,
      motoristas: p._count.motoristas,
      acessos: this.acessosDe(p as unknown as Record<string, unknown>),
    }));
  }

  async criar(dados: SalvarPerfilAcessoInput) {
    await this.recusarNomeRepetido(dados.nome, null);
    const p = await this.prisma.perfilAcessoApp.create({
      data: {
        nome: dados.nome,
        descricao: dados.descricao?.trim() || null,
        sugeridoPara: dados.sugeridoPara ?? null,
        ...dados.acessos,
      },
    });
    return { id: p.id };
  }

  /**
   * Edita o perfil E REESCREVE quem está nele.
   *
   * ⚠️ É o ponto inteiro do perfil: "liguei a leitura de ticket pro perfil
   * Motorista de frete" tem que chegar nos trinta, senão o perfil é só um
   * rótulo decorativo e o escritório continua ligando um por um.
   *
   * ⚠️ E isso APAGA as exceções de quem está no perfil, de propósito: aplicar
   * o molde é dizer "todos deste tipo ficam assim". A tela avisa quantas
   * pessoas serão reescritas antes de salvar — sem o aviso, alguém tira uma
   * exceção que outra pessoa pôs semana passada sem nunca saber.
   */
  async editar(id: string, dados: SalvarPerfilAcessoInput) {
    const atual = await this.prisma.perfilAcessoApp.findFirst({ where: { id } });
    if (!atual) throw new NotFoundException("Perfil não encontrado.");
    await this.recusarNomeRepetido(dados.nome, id);

    return this.prisma.$transaction(async (tx) => {
      const p = await tx.perfilAcessoApp.update({
        where: { id },
        data: {
          nome: dados.nome,
          descricao: dados.descricao?.trim() || null,
          sugeridoPara: dados.sugeridoPara ?? null,
          ...dados.acessos,
        },
      });
      const { count } = await tx.motorista.updateMany({
        where: { perfilAcessoId: id },
        data: { ...dados.acessos },
      });
      return { id: p.id, motoristasAtualizados: count };
    });
  }

  /**
   * Põe uma ou várias pessoas no perfil, escrevendo os acessos dele.
   *
   * Em lote de propósito: a operação real é "estes oito são motoristas de
   * frete", e fazer isso um a um é exatamente o trabalho que o perfil veio
   * eliminar.
   */
  async aplicar(perfilId: string, motoristaIds: string[]) {
    const perfil = await this.prisma.perfilAcessoApp.findFirst({ where: { id: perfilId } });
    if (!perfil) throw new NotFoundException("Perfil não encontrado.");
    if (!perfil.ativo) throw new BadRequestException("Este perfil está desligado.");
    if (motoristaIds.length === 0) return { atualizados: 0 };

    const acessos = this.acessosDe(perfil as unknown as Record<string, unknown>);
    const { count } = await this.prisma.motorista.updateMany({
      where: { id: { in: motoristaIds } },
      data: { perfilAcessoId: perfilId, ...acessos },
    });
    return { atualizados: count };
  }

  /**
   * Desliga o perfil. Quem estava nele FICA COMO ESTÁ.
   *
   * ⚠️ Não é descuido: desligar um molde não pode tirar acesso de trinta
   * pessoas que estão trabalhando. O vínculo se desfaz (`perfilAcessoId`
   * volta a null) e cada um segue com o que tinha — que é o estado de antes
   * de existir perfil nenhum.
   */
  async desligar(id: string) {
    const perfil = await this.prisma.perfilAcessoApp.findFirst({ where: { id } });
    if (!perfil) throw new NotFoundException("Perfil não encontrado.");
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.motorista.updateMany({
        where: { perfilAcessoId: id },
        data: { perfilAcessoId: null },
      });
      await tx.perfilAcessoApp.update({ where: { id }, data: { ativo: false } });
      return { soltos: count };
    });
  }

  private async recusarNomeRepetido(nome: string, ignorarId: string | null) {
    const existe = await this.prisma.perfilAcessoApp.findFirst({
      where: { nome, ...(ignorarId ? { id: { not: ignorarId } } : {}) },
      select: { id: true },
    });
    if (existe) {
      throw new BadRequestException(
        `Já existe um perfil chamado "${nome}". Dois com o mesmo nome tornam a lista inútil justamente na hora de escolher.`,
      );
    }
  }
}
