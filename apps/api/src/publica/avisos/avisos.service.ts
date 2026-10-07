import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron } from "@nestjs/schedule";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { escopoCabeEm, type EscopoIntegracao } from "@ronan/shared-types";
import { PrismaService } from "../../prisma/prisma.service";
import { AdminInboxService } from "../../admin/inbox/inbox.service";
import { comConta, comoSistema } from "../../common/conta/conta-context";
import { estadoDaConta } from "../../common/conta/estado-da-conta";
import { modulosDaConta, tetoDaConta } from "../../common/conta/teto-da-conta";
import { chaveDoLock, comLockDeCron } from "../../common/cron-exclusivo";
import { cifrar, decifrar } from "../../common/cripto";
import { enviarAviso, type ResultadoEnvio } from "./enviar";

/** Sal próprio: a chave que cifra o segredo do aviso não é a das chaves de IA. */
const SAL_AVISO = "ronan:aviso-integracao:v1";

/**
 * Espera depois de cada tentativa que falhou. Somando dá ~3 dias, a janela
 * prometida nos Termos; esgotou, a entrega vira FALHOU e o sistema de fora
 * recupera o que perdeu pelo "o que mudou desde" (/v1/alteracoes).
 */
export const ESPERAS_MS = [5_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000, 5 * 3_600_000, ...Array(6).fill(10 * 3_600_000)] as number[];
/** Falhando sem nenhum sucesso por isto, o aviso desliga e o administrador é avisado. */
const DESLIGA_APOS_MS = 3 * 86_400_000;
const LOTE_PUBLICAR = 500;
const LOTE_ENTREGAR = 200;
const ENDERECOS_EM_PARALELO = 8;

type Linha = {
  seq: bigint;
  contaId: string;
  entidade: string;
  entidadeId: string;
  operacao: string;
  eventos: string[];
  integracaoId: string | null;
};

const TIPO_DA_OPERACAO: Record<string, string> = {
  CRIADA: "viagem.criada",
  ATUALIZADA: "viagem.atualizada",
  EXCLUIDA: "viagem.excluida",
};

export function segredoDosAvisos(config: ConfigService): string | null {
  return config.get<string>("WEBHOOK_CRIPTO_SECRET")?.trim() || null;
}
export const cifrarSegredoAviso = (segredo: string, chave: string) => cifrar(segredo, chave, SAL_AVISO);
export const decifrarSegredoAviso = (guardado: string, chave: string) => decifrar(guardado, chave, SAL_AVISO);

/**
 * Os avisos automáticos (webhooks) da API pública.
 *
 * Dois robôs, cada um numa instância só (`comLockDeCron`):
 *
 * 1. PUBLICAR — pega o que o gatilho do banco anotou (`registro_alteracoes`) e
 *    ainda não tem `ordem`, numera em sequência e cria as entregas pros avisos
 *    ligados. Numerar DEPOIS de gravado (e não no gatilho) é o que garante que
 *    quem lê "o que mudou desde" nunca pule uma linha de transação lenta: ela
 *    só ganha número quando já está visível.
 * 2. ENTREGAR — manda as entregas devidas, um endereço de cada vez por cliente
 *    (endereço fora do ar não segura a fila dos outros), e na hora de mandar
 *    confere de novo se a integração está viva, a empresa pode entrar, tem o
 *    módulo e o escopo de ver viagens. Não passou: DESCARTADA, com o motivo.
 */
@Injectable()
export class AvisosService {
  private readonly log = new Logger(AvisosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly inbox: AdminInboxService,
  ) {}

  @Cron("*/5 * * * * *", { name: "avisos-integracao" })
  async rodar(): Promise<void> {
    await comLockDeCron(this.prisma, "avisos-publicar", async () => void (await comoSistema(() => this.publicar())));
    await comLockDeCron(this.prisma, "avisos-entregar", async () => void (await comoSistema(() => this.entregar())));
  }

  @Cron("0 40 4 * * *", { name: "avisos-limpeza", timeZone: "America/Sao_Paulo" })
  async limpar(): Promise<void> {
    await comLockDeCron(this.prisma, "avisos-limpeza", () =>
      comoSistema(async () => {
        const corte = new Date(Date.now() - 30 * 86_400_000);
        await this.prisma.registroAlteracao.deleteMany({ where: { criadoEm: { lt: corte }, ordem: { not: null } } });
        await this.prisma.entregaAviso.deleteMany({ where: { criadoEm: { lt: corte }, status: { not: "PENDENTE" } } });
        await this.prisma.idempotenciaIntegracao.deleteMany({ where: { expiraEm: { lt: new Date() } } });
      }),
    );
  }

  // --------------------------------------------------------------- publicar --

  /** Numera o que está pendente e cria as entregas. Devolve quantas linhas publicou. */
  async publicar(): Promise<number> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${chaveDoLock("avisos-ordem")})`;
        const linhas = await tx.$queryRaw<Linha[]>`
          WITH base AS (SELECT coalesce(max(ordem), 0) AS m FROM registro_alteracoes),
               alvo AS (
                 SELECT seq, row_number() OVER (ORDER BY seq) AS rn
                 FROM registro_alteracoes WHERE ordem IS NULL ORDER BY seq LIMIT ${LOTE_PUBLICAR}
               )
          UPDATE registro_alteracoes r
             SET ordem = base.m + alvo.rn, "publicadoEm" = now()
            FROM alvo, base
           WHERE r.seq = alvo.seq
          RETURNING r.seq, r."contaId", r.entidade, r."entidadeId", r.operacao, r.eventos, r."integracaoId"`;
        if (linhas.length === 0) return 0;

        const contas = [...new Set(linhas.map((l) => l.contaId))];
        const avisos = await tx.avisoIntegracao.findMany({
          where: { contaId: { in: contas }, ativo: true, integracao: { revogadaEm: null } },
          select: { id: true, contaId: true, integracaoId: true, eventos: true, integracao: { select: { sistema: true } } },
        });
        if (avisos.length === 0) return linhas.length;

        for (const l of linhas.sort((a, b) => Number(a.seq - b.seq))) {
          for (const a of avisos.filter((x) => x.contaId === l.contaId)) {
            // O que a própria integração escreveu não volta pra ela como aviso.
            if (l.integracaoId && l.integracaoId === a.integracaoId) continue;
            const tipos = [TIPO_DA_OPERACAO[l.operacao], ...l.eventos].filter((t): t is string => !!t && a.eventos.includes(t));
            for (const tipo of tipos) await this.criarEntrega(tx, a, l, tipo);
          }
        }
        return linhas.length;
      },
      { timeout: 60_000 },
    );
  }

  private async criarEntrega(
    tx: Prisma.TransactionClient,
    a: { id: string; contaId: string; integracao: { sistema: string } },
    l: Linha,
    tipo: string,
  ): Promise<void> {
    // Mil mudanças da mesma viagem antes da entrega viram UM aviso: o aviso é
    // magro ("mudou"), e o sistema de fora busca o estado atual de qualquer jeito.
    if (tipo === "viagem.atualizada") {
      const jaVai = await tx.entregaAviso.findFirst({
        where: { avisoId: a.id, entidadeId: l.entidadeId, tipo, status: "PENDENTE", tentativas: 0 },
        select: { id: true },
      });
      if (jaVai) return;
    }
    const vinculo = await tx.vinculoExterno.findFirst({
      where: { contaId: l.contaId, sistema: a.integracao.sistema, entidade: l.entidade, entidadeId: l.entidadeId },
      select: { idExterno: true },
    });
    let conferidaPor: string | undefined;
    if (tipo === "viagem.conferida") {
      const v = await tx.viagem.findUnique({
        where: { id: l.entidadeId },
        select: { conferenciaDispensadaEm: true, conferidoPorIaEm: true, revisadoPorId: true },
      });
      conferidaPor = v?.conferenciaDispensadaEm ? "DISPENSADA" : v?.conferidoPorIaEm && !v.revisadoPorId ? "AUTOMATICA" : "PESSOA";
    }
    const eventoId = `evt_${randomUUID().replace(/-/g, "")}`;
    await tx.entregaAviso.create({
      data: {
        contaId: l.contaId,
        avisoId: a.id,
        eventoId,
        tipo,
        entidadeId: l.entidadeId,
        payload: {
          id: eventoId,
          tipo,
          criadoEm: new Date().toISOString(),
          dados: {
            [l.entidade]: { id: l.entidadeId, externo: vinculo?.idExterno ?? null },
            ...(conferidaPor ? { conferidaPor } : {}),
          },
        },
      },
    });
  }

  // --------------------------------------------------------------- entregar --

  async entregar(): Promise<number> {
    const chave = segredoDosAvisos(this.config);
    if (!chave) return 0;
    const devidas = await this.prisma.entregaAviso.findMany({
      where: { status: "PENDENTE", proximaTentativaEm: { lte: new Date() } },
      orderBy: { criadoEm: "asc" },
      take: LOTE_ENTREGAR,
      select: { id: true, avisoId: true },
    });
    if (devidas.length === 0) return 0;

    const porAviso = new Map<string, string[]>();
    for (const d of devidas) porAviso.set(d.avisoId, [...(porAviso.get(d.avisoId) ?? []), d.id]);
    const filas = [...porAviso.entries()];
    const podeEnviar = new Map<string, string | null>();
    let feitas = 0;
    await Promise.all(
      Array.from({ length: Math.min(ENDERECOS_EM_PARALELO, filas.length) }, async () => {
        for (let f = filas.shift(); f; f = filas.shift()) feitas += await this.entregarDoAviso(f[0], f[1], chave, podeEnviar);
      }),
    );
    return feitas;
  }

  /** As entregas de UM endereço, em ordem. Falhou uma: as outras esperam junto (o endereço está fora). */
  private async entregarDoAviso(avisoId: string, ids: string[], chave: string, podeEnviar: Map<string, string | null>): Promise<number> {
    const aviso = await this.prisma.avisoIntegracao.findUnique({
      where: { id: avisoId },
      include: { integracao: { select: { id: true, revogadaEm: true, escopos: true } } },
    });
    if (!aviso) return 0;
    const bloqueio = aviso.ativo ? await this.motivoParaNaoEnviar(aviso.contaId, aviso.integracao, podeEnviar) : "Avisos desligados.";
    if (bloqueio) {
      await this.prisma.entregaAviso.updateMany({ where: { id: { in: ids } }, data: { status: "DESCARTADA", ultimoErro: bloqueio, proximaTentativaEm: null } });
      return 0;
    }
    const segredo = decifrarSegredoAviso(aviso.segredoCifrado, chave);
    if (!segredo) {
      await this.prisma.entregaAviso.updateMany({ where: { id: { in: ids } }, data: { status: "DESCARTADA", ultimoErro: "Segredo do aviso ilegível.", proximaTentativaEm: null } });
      return 0;
    }

    let n = 0;
    for (const id of ids) {
      const e = await this.prisma.entregaAviso.findUnique({ where: { id } });
      if (!e || e.status !== "PENDENTE") continue;
      const r = await enviarAviso({ url: aviso.url, segredo, eventoId: e.eventoId, corpo: JSON.stringify(e.payload) });
      n++;
      if (r.ok) {
        await this.prisma.$transaction([
          this.prisma.entregaAviso.update({
            where: { id },
            data: { status: "ENTREGUE", tentativas: { increment: 1 }, ultimoStatusHttp: r.status, ultimoErro: null, duracaoMs: r.duracaoMs, entregueEm: new Date(), proximaTentativaEm: null },
          }),
          this.prisma.avisoIntegracao.update({ where: { id: avisoId }, data: { falhasSeguidas: 0, primeiraFalhaEm: null, ultimoSucessoEm: new Date() } }),
        ]);
        continue;
      }
      await this.registrarFalha(aviso, e.id, e.tentativas, r, ids);
      break;
    }
    return n;
  }

  private async registrarFalha(
    aviso: { id: string; contaId: string; primeiraFalhaEm: Date | null; integracaoId: string; url: string },
    entregaId: string,
    tentativasAntes: number,
    r: ResultadoEnvio,
    fila: string[],
  ): Promise<void> {
    const agora = new Date();
    const tentativas = tentativasAntes + 1;
    const esgotou = tentativas > ESPERAS_MS.length;
    const proxima = esgotou ? null : new Date(agora.getTime() + ESPERAS_MS[tentativas - 1]!);
    await this.prisma.entregaAviso.update({
      where: { id: entregaId },
      data: { status: esgotou ? "FALHOU" : "PENDENTE", tentativas, ultimoStatusHttp: r.status, ultimoErro: r.erro, duracaoMs: r.duracaoMs, proximaTentativaEm: proxima },
    });
    // Endereço fora do ar: as outras entregas dele esperam o mesmo tempo, em
    // bloco — senão cada uma gastaria 10 s de timeout e seguraria o robô.
    if (proxima) {
      await this.prisma.entregaAviso.updateMany({
        where: { id: { in: fila.filter((x) => x !== entregaId) }, status: "PENDENTE", proximaTentativaEm: { lt: proxima } },
        data: { proximaTentativaEm: proxima },
      });
    }
    const primeira = aviso.primeiraFalhaEm ?? agora;
    await this.prisma.avisoIntegracao.update({
      where: { id: aviso.id },
      data: { falhasSeguidas: { increment: 1 }, primeiraFalhaEm: primeira },
    });
    if (r.desligar || agora.getTime() - primeira.getTime() > DESLIGA_APOS_MS) {
      await this.desligarPorFalha(aviso, r.desligar ? "O sistema de vocês respondeu 410 (endereço encerrado)." : "Três dias sem conseguir entregar.");
    }
  }

  async desligarPorFalha(aviso: { id: string; contaId: string; integracaoId: string; url: string }, motivo: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.avisoIntegracao.update({ where: { id: aviso.id }, data: { ativo: false, desligadoEm: new Date(), motivoDesligamento: motivo } }),
      this.prisma.entregaAviso.updateMany({
        where: { avisoId: aviso.id, status: "PENDENTE" },
        data: { status: "DESCARTADA", ultimoErro: "Avisos desligados por falha.", proximaTentativaEm: null },
      }),
    ]);
    const integ = await this.prisma.integracao.findUnique({ where: { id: aviso.integracaoId }, select: { nome: true } });
    await comConta(aviso.contaId, () =>
      this.inbox
        .disparar({
          tipo: "integracao",
          titulo: `Avisos de "${integ?.nome ?? "integração"}" desligados`,
          corpo: `${motivo} O sistema de vocês pode buscar o que perdeu pela consulta "o que mudou desde". Religue em Ajustes › Conectar outro sistema.`,
          dados: { integracaoId: aviso.integracaoId },
          permissao: "integracoes.gerenciar",
        })
        .catch((err: Error) => this.log.warn(`aviso ao admin não saiu: ${err.message}`)),
    );
  }

  /** Confere tudo de novo NA HORA de mandar: revogar, cancelar módulo ou suspender a empresa para os avisos também. */
  private async motivoParaNaoEnviar(
    contaId: string,
    integ: { id: string; revogadaEm: Date | null; escopos: string[] },
    cache: Map<string, string | null>,
  ): Promise<string | null> {
    if (integ.revogadaEm) return "A conexão foi desligada.";
    if (!cache.has(contaId)) {
      const conta = await this.prisma.conta.findUnique({
        where: { id: contaId },
        select: { ativa: true, somenteLeitura: true, trialExpiraEm: true, motivoBloqueio: true },
      });
      let motivo: string | null = null;
      if (!conta || !estadoDaConta(conta).podeEntrar) motivo = "Empresa com acesso suspenso.";
      else if (!(await modulosDaConta(this.prisma, contaId)).has("integracoes")) motivo = "Módulo Integrações não contratado.";
      cache.set(contaId, motivo);
      cache.set(`teto:${contaId}`, JSON.stringify([...(await tetoDaConta(this.prisma, contaId))]));
    }
    const daConta = cache.get(contaId);
    if (daConta) return daConta;
    const teto = new Set<string>(JSON.parse(cache.get(`teto:${contaId}`) ?? "[]"));
    const podeLer = (integ.escopos as EscopoIntegracao[]).includes("viagens:ler") && escopoCabeEm("viagens:ler", teto);
    return podeLer ? null : "A conexão não tem mais o escopo de ver viagens.";
  }
}
