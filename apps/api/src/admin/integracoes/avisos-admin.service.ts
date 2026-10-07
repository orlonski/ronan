import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AcaoAuditoria } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { AvisoResumo, EntregaAvisoResumo, EventoIntegracao, SalvarAvisoInput } from "@ronan/shared-types";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditoriaService } from "../../auditoria/auditoria.service";
import { comoSistema } from "../../common/conta/conta-context";
import type { AuthAdminUser } from "../../auth/types";
import { gerarSegredoAviso } from "../../publica/avisos/assinatura";
import { DestinoRecusado, resolverDestino } from "../../publica/avisos/destino-seguro";
import { enviarAviso } from "../../publica/avisos/enviar";
import { cifrarSegredoAviso, decifrarSegredoAviso, segredoDosAvisos } from "../../publica/avisos/avisos.service";

/** Só o host: o caminho do endereço do cliente pode carregar segredo dele. */
const soHost = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return "?";
  }
};

/**
 * Os avisos automáticos de uma conexão, vistos do painel. A chave que cifra o
 * segredo (`WEBHOOK_CRIPTO_SECRET`) é própria: sem ela, avisos não ligam —
 * guardar segredo de assinatura em claro não é opção.
 */
@Injectable()
export class AvisosAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly auditoria: AuditoriaService,
  ) {}

  disponivel(): boolean {
    return !!segredoDosAvisos(this.config);
  }

  async obter(integracaoId: string): Promise<{ disponivel: boolean; aviso: AvisoResumo | null; entregas: EntregaAvisoResumo[] }> {
    const a = await this.prisma.avisoIntegracao.findUnique({ where: { integracaoId } });
    const entregas = a
      ? await this.prisma.entregaAviso.findMany({ where: { avisoId: a.id }, orderBy: { criadoEm: "desc" }, take: 30 })
      : [];
    return {
      disponivel: this.disponivel(),
      aviso: a
        ? {
            url: a.url,
            eventos: a.eventos as EventoIntegracao[],
            ativo: a.ativo,
            desligadoEm: a.desligadoEm?.toISOString() ?? null,
            motivoDesligamento: a.motivoDesligamento,
            falhasSeguidas: a.falhasSeguidas,
            ultimoSucessoEm: a.ultimoSucessoEm?.toISOString() ?? null,
          }
        : null,
      entregas: entregas.map((e) => ({
        id: e.id,
        eventoId: e.eventoId,
        tipo: e.tipo,
        status: e.status as EntregaAvisoResumo["status"],
        tentativas: e.tentativas,
        ultimoStatusHttp: e.ultimoStatusHttp,
        ultimoErro: e.ultimoErro,
        duracaoMs: e.duracaoMs,
        criadoEm: e.criadoEm.toISOString(),
        entregueEm: e.entregueEm?.toISOString() ?? null,
        proximaTentativaEm: e.status === "PENDENTE" ? e.proximaTentativaEm?.toISOString() ?? null : null,
      })),
    };
  }

  /** Cadastra ou troca o endereço/eventos. No cadastro, devolve o segredo de assinatura UMA vez. */
  async salvar(user: AuthAdminUser, integracaoId: string, input: SalvarAvisoInput): Promise<{ segredo: string | null }> {
    const chave = this.exigirChave();
    if (user.assumida) throw new ForbiddenException("Você está visitando esta empresa: quem liga avisos é alguém dela.");
    const integ = await this.prisma.integracao.findUnique({ where: { id: integracaoId } });
    if (!integ || integ.revogadaEm) throw new NotFoundException("Conexão não encontrada ou desligada.");
    if (!integ.escopos.includes("viagens:ler")) {
      throw new ConflictException("Esta conexão não pode ver viagens; o aviso diz qual viagem mudou e o sistema busca com a chave. Crie uma conexão com \"Vê viagens\".");
    }
    try {
      await resolverDestino(input.url);
    } catch (e) {
      throw new BadRequestException(e instanceof DestinoRecusado ? e.message : "Endereço recusado.");
    }
    const atual = await this.prisma.avisoIntegracao.findUnique({ where: { integracaoId } });
    if (atual) {
      await this.prisma.avisoIntegracao.update({ where: { id: atual.id }, data: { url: input.url, eventos: input.eventos } });
      await this.auditar(user, integracaoId, AcaoAuditoria.UPDATE, { host: soHost(input.url), eventos: input.eventos });
      return { segredo: null };
    }
    const segredo = gerarSegredoAviso();
    await this.prisma.avisoIntegracao.create({
      data: { integracaoId, url: input.url, eventos: input.eventos, segredoCifrado: cifrarSegredoAviso(segredo, chave), criadoPorId: user.id },
    });
    await this.auditar(user, integracaoId, AcaoAuditoria.UPDATE, { avisosLigados: true, host: soHost(input.url), eventos: input.eventos });
    return { segredo };
  }

  /** Manda um aviso de teste AGORA e devolve o que aconteceu (sem tentar de novo). */
  async testar(integracaoId: string): Promise<{ ok: boolean; status: number | null; erro: string | null; duracaoMs: number }> {
    const chave = this.exigirChave();
    const a = await this.prisma.avisoIntegracao.findUnique({ where: { integracaoId } });
    if (!a) throw new NotFoundException("Cadastre o endereço antes.");
    const segredo = decifrarSegredoAviso(a.segredoCifrado, chave);
    if (!segredo) throw new ServiceUnavailableException("Segredo do aviso ilegível.");
    const eventoId = `evt_${randomUUID().replace(/-/g, "")}`;
    const payload = { id: eventoId, tipo: "teste", criadoEm: new Date().toISOString(), dados: { mensagem: "Aviso de teste do Movatruck." } };
    const r = await enviarAviso({ url: a.url, segredo, eventoId, corpo: JSON.stringify(payload) });
    await this.prisma.entregaAviso.create({
      data: {
        avisoId: a.id,
        eventoId,
        tipo: "teste",
        payload,
        status: r.ok ? "ENTREGUE" : "FALHOU",
        tentativas: 1,
        ultimoStatusHttp: r.status,
        ultimoErro: r.erro,
        duracaoMs: r.duracaoMs,
        entregueEm: r.ok ? new Date() : null,
        proximaTentativaEm: null,
      },
    });
    return { ok: r.ok, status: r.status, erro: r.erro, duracaoMs: r.duracaoMs };
  }

  async desligar(user: AuthAdminUser, integracaoId: string, motivo: string): Promise<void> {
    const a = await this.prisma.avisoIntegracao.findUnique({ where: { integracaoId } });
    if (!a || !a.ativo) return;
    await this.prisma.$transaction([
      this.prisma.avisoIntegracao.update({ where: { id: a.id }, data: { ativo: false, desligadoEm: new Date(), motivoDesligamento: motivo } }),
      this.prisma.entregaAviso.updateMany({
        where: { avisoId: a.id, status: "PENDENTE" },
        data: { status: "DESCARTADA", ultimoErro: "Avisos desligados no painel.", proximaTentativaEm: null },
      }),
    ]);
    await this.auditar(user, integracaoId, AcaoAuditoria.UPDATE, { avisosDesligados: true }, motivo);
  }

  async religar(user: AuthAdminUser, integracaoId: string): Promise<void> {
    this.exigirChave();
    const a = await this.prisma.avisoIntegracao.findUnique({ where: { integracaoId } });
    if (!a) throw new NotFoundException("Cadastre o endereço antes.");
    await this.prisma.avisoIntegracao.update({
      where: { id: a.id },
      data: { ativo: true, desligadoEm: null, motivoDesligamento: null, falhasSeguidas: 0, primeiraFalhaEm: null },
    });
    await this.auditar(user, integracaoId, AcaoAuditoria.UPDATE, { avisosReligados: true });
  }

  /** Manda de novo, com o MESMO id de evento: quem já processou descarta. */
  async reentregar(integracaoId: string, entregaId: string): Promise<void> {
    const e = await this.prisma.entregaAviso.findFirst({ where: { id: entregaId, aviso: { integracaoId } } });
    if (!e) throw new NotFoundException("Entrega não encontrada.");
    if (e.tipo === "teste") throw new BadRequestException("Use \"Enviar teste\".");
    await this.prisma.entregaAviso.create({
      data: { avisoId: e.avisoId, eventoId: e.eventoId, tipo: e.tipo, entidadeId: e.entidadeId, payload: e.payload as object, reentregaDeId: e.id },
    });
  }

  private exigirChave(): string {
    const chave = segredoDosAvisos(this.config);
    if (!chave) {
      throw new ServiceUnavailableException("Avisos automáticos ainda não estão disponíveis (falta configurar o servidor). Fale com a Movatruck.");
    }
    return chave;
  }

  private auditar(user: AuthAdminUser, integracaoId: string, acao: AcaoAuditoria, valorDepois: object, motivo?: string) {
    return this.auditoria.log({ usuarioId: user.id, entidade: "Integracao", entidadeId: integracaoId, acao, campo: "avisos", valorDepois, motivo });
  }
}

/**
 * O interruptor do registro de mudanças, da PLATAFORMA. Desliga os gatilhos
 * sem mexer no código (se um dia o registro pesar no lançamento do app).
 * Religar marca uma geração nova: cursor de antes da pausa recebe 410, porque
 * o que mudou durante a pausa não está registrado.
 */
@Injectable()
export class RegistroAlteracoesService {
  constructor(private readonly prisma: PrismaService) {}

  async estado(): Promise<{ ligado: boolean; desligadoEm: string | null }> {
    return comoSistema(async () => {
      const r = await this.prisma.$queryRaw<{ ligado: boolean }[]>`
        SELECT tgenabled <> 'D' AS ligado FROM pg_trigger WHERE tgname = 'registrar_alteracao_viagem'`;
      const c = await this.prisma.configuracaoPlataforma.findUnique({ where: { id: "singleton" }, select: { registroAlteracoesDesligadoEm: true } });
      return { ligado: r[0]?.ligado ?? false, desligadoEm: c?.registroAlteracoesDesligadoEm?.toISOString() ?? null };
    });
  }

  async definir(ligar: boolean): Promise<{ ligado: boolean; desligadoEm: string | null }> {
    await comoSistema(async () => {
      const acao = ligar ? "ENABLE" : "DISABLE";
      await this.prisma.$executeRawUnsafe(`ALTER TABLE "viagens" ${acao} TRIGGER registrar_alteracao_viagem`);
      await this.prisma.$executeRawUnsafe(`ALTER TABLE "viagem_valores" ${acao} TRIGGER registrar_alteracao_valor_viagem`);
      const antes = await this.prisma.configuracaoPlataforma.findUnique({ where: { id: "singleton" }, select: { registroAlteracoesDesligadoEm: true } });
      // Religar o que já estava ligado não é pausa: não invalida cursor de ninguém.
      if (ligar && !antes?.registroAlteracoesDesligadoEm) return;
      if (ligar) {
        const max = await this.prisma.registroAlteracao.aggregate({ _max: { ordem: true } });
        await this.prisma.configuracaoPlataforma.upsert({
          where: { id: "singleton" },
          create: { id: "singleton", registroAlteracoesDesligadoEm: null, registroAlteracoesOrdemMinima: max._max.ordem ?? 0n },
          update: { registroAlteracoesDesligadoEm: null, registroAlteracoesOrdemMinima: max._max.ordem ?? 0n },
        });
      } else {
        await this.prisma.configuracaoPlataforma.upsert({
          where: { id: "singleton" },
          create: { id: "singleton", registroAlteracoesDesligadoEm: new Date() },
          update: { registroAlteracoesDesligadoEm: new Date() },
        });
      }
    });
    return this.estado();
  }
}
