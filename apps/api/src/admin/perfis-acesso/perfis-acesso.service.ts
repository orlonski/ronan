import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { AcaoAuditoria } from "@prisma/client";
import {
  ACESSOS_APP_CHAVES,
  type AcessosApp,
  type SalvarPerfilAcessoInput,
} from "@ronan/shared-types";
import { AuditoriaService } from "../../auditoria/auditoria.service";
import { PERFIS_HERDADOS } from "../../common/acesso-app/espelho-colunas";
import { contaIdAtual } from "../../common/conta/conta-context";
import { type EscopoAdmin, filtroEscopo } from "../../common/escopo/escopo";
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
 *
 * ⚠️ ESCOPO DE FROTA. O perfil vale pra conta inteira: editar reescreve TODO
 * mundo que está nele, de qualquer transportadora. Por isso criar, editar e
 * desligar exigem acesso global — um gestor de frota terceira que editasse o
 * perfil mexeria no celular de motorista que ele nem enxerga. Aplicar é por
 * pessoa, então aí o escopo FILTRA: ele aplica nos dele, e só nos dele.
 */
/**
 * Os perfis que o espelho do cadastro cria (ver `espelho-colunas.ts`) não
 * existem pra esta tela: ela fala em colunas, e eles em capacidades.
 */
const SEM_HERDADOS = { nome: { notIn: PERFIS_HERDADOS } };

@Injectable()
export class PerfisAcessoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  /**
   * Nas regras, esta tela (das colunas) não escreve mais: o resolvedor é quem
   * escreve as colunas, e o que ela gravasse seria desfeito no recálculo.
   */
  private async exigirEspelho() {
    const cfg = await this.prisma.configuracaoAcessoApp.findUnique({
      where: { contaId: contaIdAtual() },
      select: { fonte: true },
    });
    if (cfg?.fonte === "REGRAS") {
      throw new ConflictException("Esta empresa configura o acesso pela tela Acesso ao app.");
    }
  }

  private exigirGlobal(escopo: EscopoAdmin) {
    if (escopo) {
      throw new ForbiddenException(
        "O perfil vale pra empresa inteira, e o seu acesso é restrito a algumas transportadoras. Peça pra quem tem acesso a todas.",
      );
    }
  }

  private acessosDe(o: Record<string, unknown>): AcessosApp {
    return Object.fromEntries(
      ACESSOS_APP_CHAVES.map((c) => [c, o[c] === true]),
    ) as AcessosApp;
  }

  async listar() {
    const perfis = await this.prisma.perfilAcessoApp.findMany({
      where: SEM_HERDADOS,
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

  async criar(dados: SalvarPerfilAcessoInput, usuarioId: string, escopo: EscopoAdmin) {
    this.exigirGlobal(escopo);
    await this.exigirEspelho();
    await this.recusarNomeRepetido(dados.nome, null);
    const p = await this.prisma.perfilAcessoApp.create({
      data: {
        nome: dados.nome,
        descricao: dados.descricao?.trim() || null,
        sugeridoPara: dados.sugeridoPara ?? null,
        ...dados.acessos,
      },
    });
    await this.auditoria.log({
      usuarioId,
      entidade: "PerfilAcessoApp",
      entidadeId: p.id,
      acao: AcaoAuditoria.UPDATE,
      campo: "criado",
      valorDepois: { nome: dados.nome, acessos: dados.acessos },
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
  async editar(id: string, dados: SalvarPerfilAcessoInput, usuarioId: string, escopo: EscopoAdmin) {
    this.exigirGlobal(escopo);
    await this.exigirEspelho();
    const atual = await this.prisma.perfilAcessoApp.findFirst({ where: { id, ...SEM_HERDADOS } });
    if (!atual) throw new NotFoundException("Perfil não encontrado.");
    await this.recusarNomeRepetido(dados.nome, id);

    const resultado = await this.prisma.$transaction(async (tx) => {
      // Quem vai ser reescrito, ANTES de reescrever: é o que a auditoria
      // precisa pra alguém reconstituir "por que o João perdeu o chat".
      const afetados = await tx.motorista.findMany({
        where: { perfilAcessoId: id },
        select: { id: true },
      });
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
      return { id: p.id, motoristasAtualizados: count, afetados: afetados.map((m) => m.id) };
    });
    await this.auditoria.log({
      usuarioId,
      entidade: "PerfilAcessoApp",
      entidadeId: id,
      acao: AcaoAuditoria.UPDATE,
      campo: "acessos",
      valorAntes: { nome: atual.nome, acessos: this.acessosDe(atual as unknown as Record<string, unknown>) },
      valorDepois: { nome: dados.nome, acessos: dados.acessos },
      metadata: { motoristasReescritos: resultado.afetados },
    });
    return { id: resultado.id, motoristasAtualizados: resultado.motoristasAtualizados };
  }

  /**
   * Põe uma ou várias pessoas no perfil, escrevendo os acessos dele.
   *
   * Em lote de propósito: a operação real é "estes oito são motoristas de
   * frete", e fazer isso um a um é exatamente o trabalho que o perfil veio
   * eliminar.
   */
  async aplicar(perfilId: string, motoristaIds: string[], usuarioId: string, escopo: EscopoAdmin) {
    await this.exigirEspelho();
    const perfil = await this.prisma.perfilAcessoApp.findFirst({ where: { id: perfilId, ...SEM_HERDADOS } });
    if (!perfil) throw new NotFoundException("Perfil não encontrado.");
    if (!perfil.ativo) throw new BadRequestException("Este perfil está desligado.");
    if (motoristaIds.length === 0) return { atualizados: 0 };

    // Só os que ele enxerga. Recusar o lote inteiro se um estiver fora seria
    // mais barulhento, mas também diria "esse id existe em outra frota" — e
    // é o que o escopo existe pra não dizer.
    const alcancaveis = await this.prisma.motorista.findMany({
      where: { id: { in: motoristaIds }, ...filtroEscopo(escopo) },
      select: { id: true },
    });
    const ids = alcancaveis.map((m) => m.id);
    if (ids.length === 0) return { atualizados: 0 };

    const acessos = this.acessosDe(perfil as unknown as Record<string, unknown>);
    const { count } = await this.prisma.motorista.updateMany({
      where: { id: { in: ids } },
      data: { perfilAcessoId: perfilId, ...acessos },
    });
    await this.auditoria.log({
      usuarioId,
      entidade: "PerfilAcessoApp",
      entidadeId: perfilId,
      acao: AcaoAuditoria.UPDATE,
      campo: "aplicado",
      valorDepois: acessos,
      metadata: { motoristas: ids },
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
  async desligar(id: string, usuarioId: string, escopo: EscopoAdmin) {
    this.exigirGlobal(escopo);
    await this.exigirEspelho();
    const perfil = await this.prisma.perfilAcessoApp.findFirst({ where: { id, ...SEM_HERDADOS } });
    if (!perfil) throw new NotFoundException("Perfil não encontrado.");
    const r = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.motorista.updateMany({
        where: { perfilAcessoId: id },
        data: { perfilAcessoId: null },
      });
      await tx.perfilAcessoApp.update({ where: { id }, data: { ativo: false } });
      return { soltos: count };
    });
    await this.auditoria.log({
      usuarioId,
      entidade: "PerfilAcessoApp",
      entidadeId: id,
      acao: AcaoAuditoria.UPDATE,
      campo: "ativo",
      valorAntes: true,
      valorDepois: false,
      metadata: { soltos: r.soltos },
    });
    return r;
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
