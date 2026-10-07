import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { AcaoAuditoria } from "@prisma/client";
import {
  ESCOPOS_INTEGRACAO,
  escopoCabeEm,
  MAX_CHAVES_ATIVAS,
  MAX_INTEGRACOES_ATIVAS,
  type ChaveGerada,
  type ChaveIntegracaoResumo,
  type CriarIntegracaoInput,
  type EscopoIntegracao,
  type IntegracaoResumo,
} from "@ronan/shared-types";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditoriaService } from "../../auditoria/auditoria.service";
import { tetoDaConta } from "../../common/conta/teto-da-conta";
import type { AuthAdminUser } from "../../auth/types";
import { gerarChave, hashDaChave, mascaraDaChave, partesVisiveis } from "../../publica/chave";

const DIA_MS = 86_400_000;

/**
 * "Conectar outro sistema": a empresa cria uma integração e recebe a chave.
 *
 * Quem pode e o quê:
 *  - ninguém cria chave mais poderosa que ele mesmo: cada escopo exige que a
 *    pessoa tenha as permissões dele (e que a empresa tenha, pelo teto);
 *  - quem só enxerga algumas frotas não cria (a chave enxergaria todas);
 *  - operador da plataforma VISITANDO a empresa não cria: entregar o dado da
 *    empresa a outro sistema é decisão dela (dados do cliente são do cliente).
 */
@Injectable()
export class IntegracoesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  /** Os escopos que ESTA pessoa pode dar numa chave. */
  async escoposQuePodeDar(user: AuthAdminUser): Promise<EscopoIntegracao[]> {
    const teto = await tetoDaConta(this.prisma, user.contaId);
    const dele = new Set(user.permissoes.filter((p) => teto.has(p)));
    return ESCOPOS_INTEGRACAO.filter((e) => escopoCabeEm(e.chave, dele)).map((e) => e.chave);
  }

  async listar(): Promise<IntegracaoResumo[]> {
    const lista = await this.prisma.integracao.findMany({
      orderBy: [{ revogadaEm: { sort: "desc", nulls: "first" } }, { criadoEm: "desc" }],
      include: { chaves: { orderBy: { criadoEm: "desc" } } },
    });
    const conta = lista[0]?.contaId;
    const teto = conta ? await tetoDaConta(this.prisma, conta) : new Set<string>();
    const desde = new Date(Date.now() - 7 * DIA_MS);
    const usos = await this.prisma.usoIntegracao.groupBy({
      by: ["integracaoId", "status"],
      where: { hora: { gte: desde } },
      _sum: { total: true },
    });
    const pessoas = await this.nomes([
      ...lista.flatMap((i) => [i.criadaPorId, ...i.chaves.map((c) => c.criadaPorId)]),
    ]);

    return lista.map((i) => {
      const meus = usos.filter((u) => u.integracaoId === i.id);
      const ultimoUso = i.chaves.map((c) => c.ultimoUsoEm).filter(Boolean).sort((a, b) => b!.getTime() - a!.getTime())[0] ?? null;
      const escopos = i.escopos as EscopoIntegracao[];
      return {
        id: i.id,
        nome: i.nome,
        sistema: i.sistema,
        escopos,
        escoposSuspensos: escopos.filter((e) => !escopoCabeEm(e, teto)),
        criadoEm: i.criadoEm.toISOString(),
        criadaPorNome: i.criadaPorId ? pessoas.get(i.criadaPorId) ?? null : null,
        revogadaEm: i.revogadaEm?.toISOString() ?? null,
        revogacaoMotivo: i.revogacaoMotivo,
        chaves: i.chaves.map((c) => this.resumoChave(c, pessoas)),
        uso: {
          ultimos7Dias: meus.reduce((s, u) => s + (u._sum.total ?? 0), 0),
          erros7Dias: meus.filter((u) => u.status >= 400).reduce((s, u) => s + (u._sum.total ?? 0), 0),
          ultimoUsoEm: ultimoUso?.toISOString() ?? null,
        },
      };
    });
  }

  async criar(user: AuthAdminUser, input: CriarIntegracaoInput): Promise<{ integracaoId: string } & ChaveGerada> {
    this.exigirQuemPodeCriar(user);
    const podeDar = new Set(await this.escoposQuePodeDar(user));
    const acima = input.escopos.filter((e) => !podeDar.has(e));
    if (acima.length) {
      throw new ForbiddenException(`Você não pode dar a uma chave o que você mesmo não pode fazer: ${acima.join(", ")}.`);
    }
    const ativas = await this.prisma.integracao.findMany({ where: { revogadaEm: null }, select: { sistema: true } });
    if (ativas.length >= MAX_INTEGRACOES_ATIVAS) {
      throw new ConflictException(`Já são ${MAX_INTEGRACOES_ATIVAS} integrações ligadas. Desligue uma que não se usa mais.`);
    }
    if (ativas.some((a) => a.sistema === input.sistema)) {
      throw new ConflictException(
        `Já existe uma integração ligada com o nome curto "${input.sistema}". Duas com o mesmo nome misturariam os números de uma com os da outra.`,
      );
    }

    const chave = gerarChave();
    const { inicio, final } = partesVisiveis(chave);
    const criada = await this.prisma.integracao.create({
      data: {
        nome: input.nome,
        sistema: input.sistema,
        escopos: [...new Set(input.escopos)],
        criadaPorId: user.id,
        chaves: { create: { hash: hashDaChave(chave), inicio, final, criadaPorId: user.id } },
      },
      include: { chaves: true },
    });
    await this.auditoria.log({
      usuarioId: user.id,
      entidade: "Integracao",
      entidadeId: criada.id,
      acao: AcaoAuditoria.INTEGRACAO_CRIADA,
      // Nunca a chave: só o que identifica.
      valorDepois: { nome: criada.nome, sistema: criada.sistema, escopos: criada.escopos, chave: mascaraDaChave(inicio, final) },
    });
    const pessoas = new Map([[user.id, user.nome]]);
    return { integracaoId: criada.id, chave, resumo: this.resumoChave(criada.chaves[0]!, pessoas) };
  }

  /** Chave nova na mesma integração: é como se troca sem parar o sistema do cliente. */
  async gerarChave(user: AuthAdminUser, integracaoId: string): Promise<ChaveGerada> {
    this.exigirQuemPodeCriar(user);
    const integ = await this.prisma.integracao.findUnique({
      where: { id: integracaoId },
      include: { chaves: { where: { revogadaEm: null }, select: { id: true } } },
    });
    if (!integ) throw new NotFoundException("Integração não encontrada.");
    if (integ.revogadaEm) throw new ConflictException("Esta integração foi desligada.");
    if (integ.chaves.length >= MAX_CHAVES_ATIVAS) {
      throw new ConflictException(`Já há ${MAX_CHAVES_ATIVAS} chaves ligadas. Desligue a antiga depois que o sistema de vocês trocar.`);
    }
    // A pessoa precisa poder dar tudo o que a integração faz — senão "gerar
    // chave" seria um jeito de herdar escopo de quem criou.
    const podeDar = new Set(await this.escoposQuePodeDar(user));
    if ((integ.escopos as EscopoIntegracao[]).some((e) => !podeDar.has(e))) {
      throw new ForbiddenException("Esta integração faz coisas que você não pode fazer; peça a quem pode.");
    }
    const chave = gerarChave();
    const { inicio, final } = partesVisiveis(chave);
    const c = await this.prisma.chaveIntegracao.create({
      data: { integracaoId, hash: hashDaChave(chave), inicio, final, criadaPorId: user.id },
    });
    await this.auditoria.log({
      usuarioId: user.id,
      entidade: "Integracao",
      entidadeId: integracaoId,
      acao: AcaoAuditoria.CHAVE_INTEGRACAO_CRIADA,
      valorDepois: { chave: mascaraDaChave(inicio, final) },
    });
    return { chave, resumo: this.resumoChave(c, new Map([[user.id, user.nome]])) };
  }

  async revogarChave(user: AuthAdminUser, integracaoId: string, chaveId: string, motivo: string): Promise<void> {
    const c = await this.prisma.chaveIntegracao.findFirst({ where: { id: chaveId, integracaoId } });
    if (!c) throw new NotFoundException("Chave não encontrada.");
    if (c.revogadaEm) return;
    await this.prisma.chaveIntegracao.update({
      where: { id: chaveId },
      data: { revogadaEm: new Date(), revogadaPorId: user.id, revogacaoMotivo: motivo },
    });
    await this.auditoria.log({
      usuarioId: user.id,
      entidade: "Integracao",
      entidadeId: integracaoId,
      acao: AcaoAuditoria.CHAVE_INTEGRACAO_REVOGADA,
      motivo,
      valorAntes: { chave: mascaraDaChave(c.inicio, c.final) },
    });
  }

  /** Desliga a integração inteira (todas as chaves). Nada do que ela gravou é apagado. */
  async revogar(user: AuthAdminUser, integracaoId: string, motivo: string): Promise<void> {
    const integ = await this.prisma.integracao.findUnique({ where: { id: integracaoId } });
    if (!integ) throw new NotFoundException("Integração não encontrada.");
    if (integ.revogadaEm) return;
    const agora = new Date();
    await this.prisma.$transaction([
      this.prisma.integracao.update({
        where: { id: integracaoId },
        data: { revogadaEm: agora, revogadaPorId: user.id, revogacaoMotivo: motivo },
      }),
      this.prisma.chaveIntegracao.updateMany({
        where: { integracaoId, revogadaEm: null },
        data: { revogadaEm: agora, revogadaPorId: user.id, revogacaoMotivo: motivo },
      }),
    ]);
    await this.auditoria.log({
      usuarioId: user.id,
      entidade: "Integracao",
      entidadeId: integracaoId,
      acao: AcaoAuditoria.INTEGRACAO_REVOGADA,
      motivo,
      valorAntes: { nome: integ.nome, sistema: integ.sistema },
    });
  }

  private exigirQuemPodeCriar(user: AuthAdminUser): void {
    if (user.assumida) {
      throw new ForbiddenException(
        "Você está visitando esta empresa. Chave de acesso entrega o dado dela a outro sistema: quem cria é alguém da própria empresa.",
      );
    }
    if (user.escopo !== null) {
      throw new ForbiddenException(
        "Seu acesso é restrito a algumas frotas, e a chave enxergaria a empresa inteira. Peça a quem administra a empresa.",
      );
    }
  }

  private resumoChave(
    c: { id: string; inicio: string; final: string; criadoEm: Date; criadaPorId: string | null; revogadaEm: Date | null; revogacaoMotivo: string | null; ultimoUsoEm: Date | null; ultimoUsoIp: string | null },
    pessoas: Map<string, string>,
  ): ChaveIntegracaoResumo {
    return {
      id: c.id,
      mascara: mascaraDaChave(c.inicio, c.final),
      criadoEm: c.criadoEm.toISOString(),
      criadaPorNome: c.criadaPorId ? pessoas.get(c.criadaPorId) ?? null : null,
      revogadaEm: c.revogadaEm?.toISOString() ?? null,
      revogacaoMotivo: c.revogacaoMotivo,
      ultimoUsoEm: c.ultimoUsoEm?.toISOString() ?? null,
      ultimoUsoIp: c.ultimoUsoIp,
    };
  }

  private async nomes(ids: (string | null)[]): Promise<Map<string, string>> {
    const unicos = [...new Set(ids.filter((x): x is string => !!x))];
    if (!unicos.length) return new Map();
    const us = await this.prisma.user.findMany({ where: { id: { in: unicos } }, select: { id: true, nome: true } });
    return new Map(us.map((u) => [u.id, u.nome]));
  }
}
