import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { ROTULO_DOCUMENTO_MOTORISTA, type TipoDocumentoMotorista } from "@ronan/shared-types";
import { PrismaService } from "../../prisma/prisma.service";
import { AdminInboxService } from "../inbox/inbox.service";
import { comLockDeCron } from "../../common/cron-exclusivo";
import { paraCadaConta } from "../../common/conta/para-cada-conta";
import {
  JANELA_AVISO_DIAS,
  diasParaVencer,
  ehDiaDeAvisar,
  situacaoDocumento,
  textoVencimento,
  type SituacaoDocumento,
} from "../../common/documento-vencimento";
import { ymdSaoPaulo } from "../../common/timezone";

export type AlertaDocumento = { texto: string; situacao: SituacaoDocumento; dias: number };

const ROTULO_DOC_VEICULO: Record<string, string> = {
  CRLV: "CRLV",
  SEGURO: "Seguro",
  TACOGRAFO: "Tacógrafo",
  ANTT: "ANTT",
  AET: "AET",
};

function hojeYmd(): string {
  return ymdSaoPaulo().map((n) => String(n).padStart(2, "0")).join("-");
}

/**
 * Documento vencendo, visto pelo GESTOR: na programação (selo no motorista e
 * no caminhão) e num resumo diário no sininho. A regra mora em
 * `common/documento-vencimento.ts`. Só avisa — não bloqueia nada.
 */
@Injectable()
export class DocumentosVencendoService {
  private readonly log = new Logger(DocumentosVencendoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inbox: AdminInboxService,
  ) {}

  /** Os selos da programação: só o que venceu ou vence nos próximos 15 dias. */
  async alertas(motoristaIds: string[], veiculoIds: string[], hoje = hojeYmd()) {
    const limite = new Date(Date.parse(`${hoje}T00:00:00Z`) + JANELA_AVISO_DIAS * 86_400_000);
    const [docsMot, docsVei] = await Promise.all([
      motoristaIds.length
        ? this.prisma.motoristaDocumento.findMany({
            where: { motoristaId: { in: motoristaIds }, validade: { not: null, lte: limite }, recusadoEm: null },
            select: { motoristaId: true, tipo: true, validade: true },
          })
        : [],
      veiculoIds.length
        ? this.prisma.documentoVeiculo.findMany({
            where: { veiculoId: { in: veiculoIds }, validade: { not: null, lte: limite } },
            select: { veiculoId: true, tipo: true, validade: true },
          })
        : [],
    ]);

    const motoristas: Record<string, AlertaDocumento[]> = {};
    for (const d of docsMot) {
      const s = situacaoDocumento(d.validade, hoje);
      if (!s || !d.motoristaId) continue;
      const rotulo = ROTULO_DOCUMENTO_MOTORISTA[d.tipo as TipoDocumentoMotorista] ?? d.tipo;
      (motoristas[d.motoristaId] ??= []).push({ ...s, texto: textoVencimento(rotulo, s.dias) });
    }
    const veiculos: Record<string, AlertaDocumento[]> = {};
    for (const d of docsVei) {
      const s = situacaoDocumento(d.validade, hoje);
      if (!s) continue;
      const rotulo = ROTULO_DOC_VEICULO[d.tipo] ?? d.tipo;
      (veiculos[d.veiculoId] ??= []).push({ ...s, texto: textoVencimento(rotulo, s.dias) });
    }
    // O mais urgente primeiro.
    for (const lista of [...Object.values(motoristas), ...Object.values(veiculos)]) {
      lista.sort((a, b) => a.dias - b.dias);
    }
    return { motoristas, veiculos };
  }

  /**
   * Resumo no sininho, uma notificação por empresa por dia — só quando algum
   * documento bate 15, 7, 1 ou 0 dias. Sem estado guardado: o marco do dia é
   * que decide, então não repete nem some se o servidor reiniciar.
   */
  @Cron("0 0 7 * * *", { name: "documentos-vencendo-gestor", timeZone: "America/Sao_Paulo" })
  async avisarGestor(): Promise<void> {
    try {
      await comLockDeCron(this.prisma, "documentos-vencendo-gestor", async () => {
        await paraCadaConta(this.prisma, (contaId) => this.avisarConta(contaId));
      });
    } catch (e) {
      this.log.error(`aviso de documentos vencendo falhou: ${(e as Error).message}`);
    }
  }

  private async avisarConta(_contaId: string, hoje = hojeYmd()): Promise<void> {
    const inicio = new Date(`${hoje}T00:00:00Z`);
    const fim = new Date(inicio.getTime() + JANELA_AVISO_DIAS * 86_400_000);
    const [docsMot, docsVei] = await Promise.all([
      this.prisma.motoristaDocumento.findMany({
        where: {
          validade: { gte: inicio, lte: fim },
          recusadoEm: null,
          motorista: { ativo: true },
        },
        select: { tipo: true, validade: true, motorista: { select: { nome: true } } },
      }),
      this.prisma.documentoVeiculo.findMany({
        where: { validade: { gte: inicio, lte: fim }, veiculo: { ativo: true } },
        select: { tipo: true, validade: true, veiculo: { select: { placa: true } } },
      }),
    ]);

    const linhasMot = docsMot
      .map((d) => ({ d, dias: diasParaVencer(d.validade!, hoje) }))
      .filter((x) => ehDiaDeAvisar(x.dias))
      .map(
        (x) =>
          `${textoVencimento(ROTULO_DOCUMENTO_MOTORISTA[x.d.tipo as TipoDocumentoMotorista] ?? x.d.tipo, x.dias)} — ${x.d.motorista?.nome ?? "motorista"}`,
      );
    const linhasVei = docsVei
      .map((d) => ({ d, dias: diasParaVencer(d.validade!, hoje) }))
      .filter((x) => ehDiaDeAvisar(x.dias))
      .map((x) => `${textoVencimento(ROTULO_DOC_VEICULO[x.d.tipo] ?? x.d.tipo, x.dias)} — ${x.d.veiculo.placa}`);

    const enviar = async (linhas: string[], de: string, permissao: string) => {
      if (linhas.length === 0) return;
      await this.inbox.disparar({
        tipo: "documento-vencendo",
        titulo: linhas.length === 1 ? linhas[0]! : `${linhas.length} documentos ${de} vencendo`,
        corpo: linhas.slice(0, 8).join("\n") + (linhas.length > 8 ? `\n…e mais ${linhas.length - 8}` : ""),
        dados: { de },
        permissao,
      });
    };
    await enviar(linhasMot, "de motorista", "motoristas.ver");
    await enviar(linhasVei, "de caminhão", "documentos-veiculo.ver");
  }
}
