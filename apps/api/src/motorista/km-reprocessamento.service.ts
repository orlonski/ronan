import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service";
import { RoteamentoService } from "../roteamento/roteamento.service";
import { PushService } from "../push/push.service";
import { KmAtipicoService } from "../km-atipico/km-atipico.service";

// Diferença mínima (km) pra considerar que o recálculo "mudou" o valor e valer
// o aviso ao motorista. Abaixo disso, só marca como reprocessado sem incomodar.
const TOLERANCIA_KM = 0.5;

/**
 * Reprocessamento automático de km. Viagem criada SEM sinal cai no cálculo
 * aproximado por linha reta (haversine) no app — `kmCalculado` chega null. Como
 * o backend está online na hora da sincronização e tem os dois pontos
 * (localCarga/localDescarga → lat/lng), aqui recalculamos pelo trajeto real
 * (OSRM), corrigimos o km e avisamos o motorista.
 *
 * Respeita o km que o motorista digitou na mão (`kmEditadoManual`): nesse caso
 * NÃO sobrescreve o valor dele — só atualiza a referência OSRM e, se divergir,
 * avisa pra ele conferir.
 *
 * Idempotente e best-effort: `kmRecalculadoEm` trava re-processo/re-aviso.
 */
@Injectable()
export class KmReprocessamentoService {
  private readonly log = new Logger(KmReprocessamentoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly roteamento: RoteamentoService,
    private readonly push: PushService,
    private readonly kmAtipico: KmAtipicoService,
  ) {}

  /** Reprocessa UMA viagem (chamado fire-and-forget após criar/finalizar). */
  async reprocessar(viagemId: string): Promise<void> {
    try {
      const v = await this.prisma.viagem.findUnique({
        where: { id: viagemId },
        select: {
          id: true,
          motoristaId: true,
          status: true,
          km: true,
          kmCalculado: true,
          kmEditadoManual: true,
          kmFonte: true,
          kmRecalculadoEm: true,
          trechos: { select: { id: true, localId: true }, orderBy: { ordem: "asc" } },
          localCargaId: true,
          localDescargaId: true,
          material: { select: { nome: true } },
          motorista: { select: { expoPushToken: true } },
          _count: { select: { matchesFechamento: true } },
        },
      });
      if (!v) return;
      // Já reprocessada, ou OSRM já rodou na criação (viagem online) → nada a fazer.
      if (v.kmRecalculadoEm) return;
      if (v.kmCalculado != null) return;
      // EM_ANDAMENTO ainda não tem km/locais definidos.
      if (v.status === "EM_ANDAMENTO") return;
      if (!v.localCargaId || !v.localDescargaId) return;
      // Já conciliada num fechamento: o km está "travado" na comparação. Não
      // mexe automaticamente (evita reabrir divergência já resolvida). Follow-up.
      if (v._count.matchesFechamento > 0) return;

      const r = await this.roteamento.calcularKm(v.localCargaId, v.localDescargaId, {
        force: true,
      });
      // OSRM fora do ar / local ainda sem coords → deixa pro @Cron tentar depois
      // (não marca kmRecalculadoEm, então continua candidata).
      if (r.km === null) return;

      let novoKm = parseFloat(r.km);
      // Trechos adicionais (retorno do bota-fora hoje): cada trecho soma a perna
      // do ponto anterior até o local dele (o 1º parte da descarga). Recalcula o
      // km de cada trecho pelo trajeto real. Se o OSRM não fechar alguma perna,
      // não marca reprocessado (o @Cron tenta de novo) pra não gravar pela metade.
      const trechoUpdates: { id: string; km: number }[] = [];
      let anterior = v.localDescargaId;
      for (const t of v.trechos) {
        const rt = await this.roteamento.calcularKm(anterior, t.localId, { force: true });
        if (rt.km === null) return;
        const kmT = parseFloat(rt.km);
        trechoUpdates.push({ id: t.id, km: kmT });
        novoKm += kmT;
        anterior = t.localId;
      }
      const atualizarTrechos =
        trechoUpdates.length > 0
          ? {
              trechos: {
                update: trechoUpdates.map((t) => ({
                  where: { id: t.id },
                  data: { km: t.km },
                })),
              },
            }
          : {};
      const kmAtual = Number(v.km ?? 0);
      const mudou = Math.abs(novoKm - kmAtual) > TOLERANCIA_KM;
      const agora = new Date();

      // Respeita o km decidido pelo motorista: digitado na mão OU aceito da
      // referência histórica da frota (kmFonte=HISTORICO). Este último é o caso
      // do §4.3: se ele tocou "Usar X km" OFFLINE, kmCalculado chega null e sem
      // esta guarda o reprocessador sobrescreveria o valor dele pelo OSRM,
      // calado — justo na rota em que a sugestão mais importa. Só atualiza a
      // referência OSRM e marca; não mexe no km faturado.
      if (v.kmEditadoManual === true || v.kmFonte === "HISTORICO") {
        await this.prisma.viagem.update({
          where: { id: v.id },
          data: {
            kmCalculado: novoKm,
            kmRecalculadoEm: agora,
            ...atualizarTrechos,
          },
        });
        if (mudou) {
          await this.notificar(v.id, v.motoristaId, v.motorista?.expoPushToken, {
            titulo: "Confere o km da sua viagem",
            corpo: `Você marcou ${fmtKm(kmAtual)} km. Pelo trajeto certo deu ${fmtKm(
              novoKm,
            )} km — se quiser, é só ajustar.`,
          });
        }
        // O km real deste par agora é conhecido → re-carimba o atípico.
        void this.kmAtipico.avaliarViagem(v.id);
        return;
      }

      // Motorista aceitou a estimativa: corrige o km faturado + a referência.
      await this.prisma.viagem.update({
        where: { id: v.id },
        data: {
          km: novoKm,
          kmCalculado: novoKm,
          kmRecalculadoEm: agora,
          kmAntesRecalculo: mudou ? v.km : null,
          ...atualizarTrechos,
        },
      });
      if (mudou) {
        const mat = v.material?.nome ? `de ${v.material.nome} ` : "";
        await this.notificar(v.id, v.motoristaId, v.motorista?.expoPushToken, {
          titulo: "Acertamos o km da sua viagem",
          corpo: `Sua viagem ${mat}foi lançada sem sinal e o km era só uma estimativa. Pelo trajeto certo: de ${fmtKm(
            kmAtual,
          )} para ${fmtKm(novoKm)} km.`,
        });
      }
      // Km faturado mudou de haversine pro trajeto real → re-carimba o atípico
      // (o carimbo inicial no create foi sobre um km que não existe mais).
      void this.kmAtipico.avaliarViagem(v.id);
    } catch (err) {
      this.log.warn(`reprocessar(${viagemId}) falhou: ${(err as Error).message}`);
    }
  }

  private async notificar(
    viagemId: string,
    motoristaId: string,
    token: string | null | undefined,
    msg: { titulo: string; corpo: string },
  ): Promise<void> {
    await this.push
      .enviar({
        motoristaId,
        token: token ?? "",
        titulo: msg.titulo,
        corpo: msg.corpo,
        tipo: "viagem-recalculada",
        dados: { viagemId },
        criadoPorId: null,
      })
      .catch(() => {
        /* best-effort */
      });
  }

  /**
   * Rede de segurança: pega o que o gatilho de sincronização não conseguiu
   * (OSRM estava fora do ar, local recém-criado ainda sem coords). Roda a cada
   * 15 min sobre as candidatas ainda não reprocessadas.
   */
  @Cron("0 */15 * * * *", { name: "reprocessar-km", timeZone: "America/Sao_Paulo" })
  async sweep(): Promise<void> {
    const candidatas = await this.prisma.viagem.findMany({
      where: {
        kmRecalculadoEm: null,
        kmCalculado: null,
        status: { notIn: ["EM_ANDAMENTO", "RASCUNHO_OFFLINE"] },
        localCargaId: { not: null },
        localDescargaId: { not: null },
        matchesFechamento: { none: {} },
      },
      select: { id: true },
      take: 50,
    });
    if (candidatas.length === 0) return;
    this.log.log(`reprocessando km de ${candidatas.length} viagem(ns)`);
    for (const c of candidatas) {
      await this.reprocessar(c.id);
    }
  }
}

/** Km amigável pro motorista: inteiro (sem casas), com sufixo tratado no caller. */
function fmtKm(km: number): string {
  return String(Math.round(km));
}
