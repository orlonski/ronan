import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import type { TipoDocumentoPessoal } from "@ronan/shared-types";
import { DIAS_AVISO_DOCUMENTO, DIAS_AVISO_PADRAO, ROTULO_DOCUMENTO_PESSOAL } from "@ronan/shared-types";
import { comoSistema } from "../common/conta/conta-context";
import { PrismaService } from "../prisma/prisma.service";
import { PushService } from "../push/push.service";

/**
 * Avisa o motorista antes do documento vencer.
 *
 * É a razão de a carteira existir: documento vencido não é só burocracia — sem
 * CNH válida, RNTRC ativo ou toxicológico em dia ele **não pega carga**, e no
 * caso do toxicológico a multa do art. 165-D chega sozinha 30 dias depois do
 * vencimento, sem ninguém parar ele na estrada.
 *
 * Uma vez por documento e por ciclo (`avisadoEm`): renovar zera a marca e o
 * ciclo recomeça. Sem isso viraria push diário sobre o mesmo papel — e push que
 * repete é push que ele desliga.
 */
@Injectable()
export class AvisoDocumentosService {
  private readonly log = new Logger(AvisoDocumentosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
  ) {}

  /** 8h da manhã: cedo o bastante pra ele resolver no mesmo dia. */
  @Cron(CronExpression.EVERY_DAY_AT_8AM, { timeZone: "America/Sao_Paulo" })
  async avisarVencimentos(): Promise<void> {
    // A janela maior cobre todos os tipos; o corte fino por tipo é feito abaixo.
    const janelaMaxima = Math.max(DIAS_AVISO_PADRAO, ...Object.values(DIAS_AVISO_DOCUMENTO));
    const limite = new Date();
    limite.setUTCDate(limite.getUTCDate() + janelaMaxima);

    const candidatos = await comoSistema(() =>
      this.prisma.documentoPessoal.findMany({
        where: { validade: { not: null, lte: limite }, avisadoEm: null },
        select: { id: true, tipo: true, validade: true, placa: true, identidadeId: true },
      }),
    );
    if (candidatos.length === 0) return;

    let avisados = 0;
    for (const doc of candidatos) {
      const dias = diasAte(doc.validade!);
      const janela = DIAS_AVISO_DOCUMENTO[doc.tipo as TipoDocumentoPessoal] ?? DIAS_AVISO_PADRAO;
      // A varredura pega todo mundo dentro da janela MÁXIMA; aqui cada tipo
      // respeita a sua. Sem isso a CNH seria avisada com 60 dias junto do
      // toxicológico.
      if (dias > janela) continue;

      const nome = ROTULO_DOCUMENTO_PESSOAL[doc.tipo as TipoDocumentoPessoal];
      const alvo = doc.placa ? `${nome} (${doc.placa})` : nome;
      await this.push
        .enviarParaIdentidade({
          identidadeId: doc.identidadeId,
          titulo: dias < 0 ? `${alvo} venceu` : `${alvo} vence em ${dias} dias`,
          corpo:
            dias < 0
              ? "Sem ele você não pega carga. Renove e atualize no app."
              : "Renove antes de vencer pra não perder frete.",
          dados: { kind: "documento-vencendo", documentoId: doc.id },
        })
        .catch(() => {});

      // Marca mesmo se o push falhar: a tela do app já mostra o vencimento em
      // vermelho, e insistir todo dia no mesmo documento é o caminho pra ele
      // desligar as notificações.
      await comoSistema(() =>
        this.prisma.documentoPessoal.update({
          where: { id: doc.id },
          data: { avisadoEm: new Date() },
        }),
      );
      avisados++;
    }
    if (avisados > 0) this.log.log(`Avisos de documento vencendo: ${avisados}`);
  }
}

function diasAte(validade: Date): number {
  const hoje = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return Math.round(
    (validade.getTime() - new Date(`${hoje}T00:00:00.000Z`).getTime()) / 86_400_000,
  );
}
