import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { achatarParam } from "@ronan/shared-types";
import {
  acaoDaRegua,
  formatarData,
  formatarReais,
  hojeData,
  mensagemCobrancaAberta,
  mensagemCobrancaAtrasada,
  rotuloCompetencia,
} from "../common/assinatura-cobranca";
import { comoSistema } from "../common/conta/conta-context";
import { PrismaService } from "../prisma/prisma.service";
import { EnvioWhatsappService } from "../whatsapp/envio/envio-whatsapp.service";
import { SessaoService } from "../whatsapp/sessao.service";
import { AssinaturasService } from "./assinaturas.service";

/**
 * A régua de cobrança — que AVISA e nunca corta.
 *
 * Esta é a decisão mais importante deste arquivo, tomada pelo dono em
 * 14/09/2026: o sistema não mexe em `Conta.ativa` nem em `somenteLeitura` por
 * causa de mensalidade. Com dois clientes, quem decide o que fazer com um
 * atraso é uma pessoa que conhece os dois — automatizar o corte transformaria
 * um boleto esquecido numa transportadora parada, e a primeira vez que isso
 * acontecesse custaria mais que o mês devido.
 *
 * O que ela faz: marca o que venceu, avisa em D-3, D+1, D+7 e D+15, e para.
 * Três avisos e silêncio — daí em diante é conversa humana.
 *
 * Roda de manhã porque cobrança é assunto de horário comercial: um aviso de
 * dívida às 3 da manhã é o jeito certo de o cliente acordar irritado.
 */
@Injectable()
export class ReguaCobrancaService {
  private readonly log = new Logger(ReguaCobrancaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly envio: EnvioWhatsappService,
    private readonly assinaturas: AssinaturasService,
  ) {}

  @Cron("0 0 9 * * *", { name: "regua-cobranca", timeZone: "America/Sao_Paulo" })
  async passar(): Promise<ResumoRegua> {
    try {
      const vencidas = await this.marcarVencidas();
      if (vencidas > 0) this.log.log(`${vencidas} cobrança(s) passaram a vencidas.`);
      const avisos = await this.avisar();
      return { vencidas, ...avisos };
    } catch (erro) {
      // Cron não derruba: a régua roda de novo amanhã, e uma falha aqui não
      // pode parar o processo que também serve o app do motorista.
      const msg = (erro as Error).message;
      this.log.error(`Falha na régua de cobrança: ${msg}`);
      return { vencidas: 0, enviados: [], naoEnviados: [], semAcao: 0, erro: msg };
    }
  }

  /**
   * Marca o que passou do vencimento.
   *
   * É rede de segurança, não a fonte da verdade: quem costuma contar isso é o
   * `PAYMENT_OVERDUE` do gateway. Mas webhook se perde — a fila do Asaas
   * INTERROMPE depois de 15 falhas seguidas — e uma cobrança vencida que
   * continua "pendente" nunca entra na régua, que é o mesmo que não cobrar.
   */
  private async marcarVencidas(): Promise<number> {
    const hoje = hojeData();
    const { count } = await comoSistema(() =>
      this.prisma.cobrancaAssinatura.updateMany({
        where: { status: "PENDENTE", vencimento: { lt: hoje } },
        data: { status: "VENCIDA" },
      }),
    );

    if (count > 0) {
      const afetadas = await comoSistema(() =>
        this.prisma.cobrancaAssinatura.findMany({
          where: { status: "VENCIDA" },
          select: { assinaturaId: true },
          distinct: ["assinaturaId"],
        }),
      );
      for (const { assinaturaId } of afetadas) {
        await this.assinaturas.reavaliarInadimplencia(assinaturaId);
      }
    }
    return count;
  }

  /** Manda o aviso do dia pra cada cobrança que a régua mandar avisar. */
  private async avisar(): Promise<Omit<ResumoRegua, "vencidas">> {
    const enviados: string[] = [];
    const naoEnviados: string[] = [];
    let semAcao = 0;
    const abertas = await comoSistema(() =>
      this.prisma.cobrancaAssinatura.findMany({
        where: {
          status: { in: ["PENDENTE", "VENCIDA"] },
          assinatura: { status: { not: "CANCELADA" } },
        },
        include: {
          assinatura: {
            select: {
              id: true,
              nomeResponsavel: true,
              telefoneCobranca: true,
              conta: { select: { nome: true } },
            },
          },
        },
        orderBy: { vencimento: "asc" },
      }),
    );

    const agora = new Date();
    for (const cobranca of abertas) {
      const acao = acaoDaRegua(
        {
          status: cobranca.status,
          vencimento: cobranca.vencimento,
          avisoAbertaEm: cobranca.avisoAbertaEm,
          avisoAtrasoEm: cobranca.avisoAtrasoEm,
          avisosAtraso: cobranca.avisosAtraso,
        },
        agora,
      );
      if (acao.tipo === "NADA") {
        semAcao++;
        continue;
      }

      // Sem link não há o que mandar: uma cobrança sem página de pagamento
      // deixaria o cliente sabendo que deve e sem como pagar, que é pior que
      // não avisar. Acontece com cobrança criada antes do gateway responder.
      if (!cobranca.linkPagamento) {
        this.log.warn(
          `Cobrança ${cobranca.id} (${cobranca.assinatura.conta.nome}) está aberta e sem link de pagamento — aviso não enviado.`,
        );
        naoEnviados.push(`${cobranca.assinatura.conta.nome}: sem link de pagamento`);
        continue;
      }

      const dados = {
        nomeResponsavel: achatarParam(cobranca.assinatura.nomeResponsavel),
        competenciaRotulo: rotuloCompetencia(cobranca.competencia),
        valor: formatarReais(cobranca.valorCentavos),
        vencimento: formatarData(cobranca.vencimento),
        link: cobranca.linkPagamento,
      };

      const atrasada = acao.tipo === "AVISAR_ATRASO";
      const { texto, params } = atrasada
        ? mensagemCobrancaAtrasada(dados)
        : mensagemCobrancaAberta(dados);

      // `tentarEnviar`, nunca `enviarOuFalhar`: um WhatsApp fora do ar não pode
      // derrubar a régua do resto dos clientes.
      const r = await this.envio.tentarEnviar({
        destino: {
          tipo: "TELEFONE",
          numero: SessaoService.normalizar(cobranca.assinatura.telefoneCobranca),
        },
        rota: atrasada ? "COBRANCA_ATRASADA" : "COBRANCA_ABERTA",
        texto,
        params: params.map(achatarParam),
      });

      if (!r.enviado) {
        // Não grava a data: sem gravar, a régua tenta de novo amanhã. Marcar
        // como avisado o que não saiu é como um cliente deixa de ser cobrado.
        this.log.warn(
          `Aviso de cobrança ${cobranca.id} não saiu (${r.erro?.codigo}): ${r.erro?.detalhe}`,
        );
        naoEnviados.push(
          `${cobranca.assinatura.conta.nome}: ${r.erro?.detalhe ?? r.erro?.codigo ?? "falhou"}`,
        );
        continue;
      }

      await comoSistema(() =>
        this.prisma.cobrancaAssinatura.update({
          where: { id: cobranca.id },
          data: atrasada
            ? { avisoAtrasoEm: new Date(), avisosAtraso: { increment: 1 } }
            : { avisoAbertaEm: new Date() },
        }),
      );

      this.log.log(
        `Aviso ${atrasada ? "de atraso" : "de abertura"} enviado: ${cobranca.assinatura.conta.nome}, ${dados.competenciaRotulo}.`,
      );
      enviados.push(
        `${cobranca.assinatura.conta.nome} (${dados.competenciaRotulo}): ${atrasada ? "atraso" : "a vencer"}`,
      );
    }

    return { enviados, naoEnviados, semAcao };
  }
}

/**
 * O que a passada da régua fez.
 *
 * Existe porque a régua passou a ter um gatilho manual, e quem aperta o botão
 * precisa ver o resultado — "rodou" sem dizer o que saiu é o mesmo que não
 * rodar. `naoEnviados` é a parte que importa: aviso que falhou não grava data e
 * será tentado de novo, mas quem está na tela tem que saber disso agora.
 */
export type ResumoRegua = {
  /** Quantas cobranças passaram a constar vencidas nesta passada. */
  vencidas: number;
  enviados: string[];
  naoEnviados: string[];
  /** Cobranças em aberto que a régua olhou e decidiu não avisar hoje. */
  semAcao: number;
  erro?: string;
};
