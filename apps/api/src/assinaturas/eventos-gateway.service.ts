import { Injectable, Logger } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { competenciaDe, formaDoGateway, statusDoGateway } from "../common/assinatura-cobranca";
import { comoSistema } from "../common/conta/conta-context";
import { PrismaService } from "../prisma/prisma.service";
import { AssinaturasService } from "./assinaturas.service";
import type { PagamentoAsaas } from "./asaas.provedor";
import { reaisParaCentavos } from "./asaas.provedor";

/**
 * O que o gateway conta, aplicado ao que a gente sabe.
 *
 * A regra de ouro aqui é oposta à do resto da API: **nada lança**. Um webhook
 * que responde erro faz o Asaas reenfileirar, e quinze falhas seguidas
 * INTERROMPEM a fila inteira — todos os eventos de todos os clientes, com 14
 * dias pra consertar antes de serem apagados. Então o handler guarda o evento
 * cru, tenta aplicar, e registra a falha na própria linha em vez de devolver
 * 500.
 *
 * Guardar primeiro e aplicar depois também resolve a ordem: confirmação e
 * estorno do mesmo pagamento podem chegar trocados, e com o payload no banco dá
 * pra reconstruir o que de fato aconteceu.
 */
@Injectable()
export class EventosGatewayService {
  private readonly log = new Logger(EventosGatewayService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly assinaturas: AssinaturasService,
  ) {}

  /**
   * Recebe um evento. Devolve o que aconteceu, sem nunca lançar.
   *
   * `duplicado` não é erro: é o caminho normal do reenvio, e responder 200 pra
   * ele é o que impede o gateway de insistir para sempre.
   */
  async receber(
    eventoId: string,
    tipo: string,
    payload: unknown,
  ): Promise<{ status: "processado" | "duplicado" | "ignorado" | "falhou"; detalhe?: string }> {
    const registrado = await comoSistema(async () => {
      const existente = await this.prisma.eventoGatewayPagamento.findUnique({
        where: { eventoId },
        select: { id: true, processadoEm: true },
      });
      if (existente) return null;
      return this.prisma.eventoGatewayPagamento.create({
        data: { eventoId, tipo, payload: payload as Prisma.InputJsonValue },
        select: { id: true },
      });
    });

    if (!registrado) return { status: "duplicado" };

    try {
      const resultado = await this.aplicar(tipo, payload);
      await comoSistema(() =>
        this.prisma.eventoGatewayPagamento.update({
          where: { id: registrado.id },
          data: { processadoEm: new Date(), erro: null },
        }),
      );
      return resultado;
    } catch (erro) {
      const detalhe = (erro as Error).message;
      // Falha nossa não pode virar erro HTTP: o evento está guardado, e o que
      // falta é conserto de código, não reenvio. A linha com `erro` preenchido
      // é o que a tela de diagnóstico mostra.
      this.log.error(`Evento ${eventoId} (${tipo}) falhou ao aplicar: ${detalhe}`);
      await comoSistema(() =>
        this.prisma.eventoGatewayPagamento.update({
          where: { id: registrado.id },
          data: { erro: detalhe.slice(0, 500) },
        }),
      );
      return { status: "falhou", detalhe };
    }
  }

  /** Traduz o evento em mudança de estado. */
  private async aplicar(
    tipo: string,
    payload: unknown,
  ): Promise<{ status: "processado" | "ignorado"; detalhe?: string }> {
    const pagamento = (payload as { payment?: PagamentoAsaas })?.payment;
    if (!pagamento?.id) {
      return { status: "ignorado", detalhe: "evento sem pagamento" };
    }

    const novoStatus = statusDoGateway(pagamento.status);
    if (!novoStatus) {
      // Status que a gente não conhece NÃO vira PENDENTE: chutar faria uma
      // cobrança paga voltar pra régua e o cliente ser cobrado de novo.
      return { status: "ignorado", detalhe: `status desconhecido: ${pagamento.status}` };
    }

    const cobranca = await this.acharOuCriarCobranca(pagamento);
    if (!cobranca) {
      // Pagamento de alguém que não é assinatura nossa. Acontece se a mesma
      // conta do gateway for usada pra outra coisa — ignorar é o certo.
      return { status: "ignorado", detalhe: "pagamento sem assinatura conhecida" };
    }

    const pago = novoStatus === "CONFIRMADA" || novoStatus === "RECEBIDA";

    await comoSistema(() =>
      this.prisma.cobrancaAssinatura.update({
        where: { id: cobranca.id },
        data: {
          status: novoStatus,
          valorCentavos: reaisParaCentavos(pagamento.value),
          valorPagoCentavos: pago
            ? reaisParaCentavos(pagamento.netValue ?? pagamento.value)
            : undefined,
          pagoEm: pago ? dataDoPagamento(pagamento) : null,
          formaPaga: formaDoGateway(pagamento.billingType) ?? undefined,
          linkPagamento: pagamento.invoiceUrl ?? undefined,
          linhaDigitavel: pagamento.identificationField ?? undefined,
          // Pagou: a régua zera. Se a mesma cobrança voltar a ficar em aberto
          // (estorno), os avisos recomeçam do zero em vez de continuarem de
          // onde pararam — o cliente não tem culpa do estorno.
          avisosAtraso: pago ? 0 : undefined,
          avisoAtrasoEm: pago ? null : undefined,
        },
      }),
    );

    if (pago) await this.marcarPrimeiroPagamento(cobranca.assinaturaId);
    await this.assinaturas.reavaliarInadimplencia(cobranca.assinaturaId);

    this.log.log(`${tipo}: cobrança ${cobranca.id} → ${novoStatus}`);
    return { status: "processado" };
  }

  /**
   * A cobrança que este pagamento representa, criando-a se for a primeira
   * notícia que temos dela.
   *
   * O gateway gera as cobranças sozinho (é pra isso que a assinatura existe lá),
   * então `PAYMENT_CREATED` costuma ser a primeira vez que vemos o mês. Criar
   * aqui é o que mantém o histórico completo sem um cron de espelhamento.
   */
  private async acharOuCriarCobranca(
    pagamento: PagamentoAsaas,
  ): Promise<{ id: string; assinaturaId: string } | null> {
    return comoSistema(async () => {
      const existente = await this.prisma.cobrancaAssinatura.findUnique({
        where: { gatewayCobrancaId: pagamento.id },
        select: { id: true, assinaturaId: true },
      });
      if (existente) return existente;

      const assinatura = await this.acharAssinatura(pagamento);
      if (!assinatura) return null;

      // A competência sai do VENCIMENTO, não da data de hoje: uma cobrança de
      // setembro criada em agosto (o gateway gera com antecedência) é de
      // setembro, e gravá-la como agosto duplicaria o mês.
      const vencimento = new Date(`${pagamento.dueDate}T00:00:00.000Z`);
      const competencia = competenciaDe(new Date(`${pagamento.dueDate}T12:00:00.000Z`));

      // `upsert` pela chave (assinatura, competência): dois eventos do mesmo
      // mês chegando juntos criariam duas linhas, e aí o cliente veria a
      // mensalidade dobrada.
      const criada = await this.prisma.cobrancaAssinatura.upsert({
        where: {
          assinaturaId_competencia: { assinaturaId: assinatura.id, competencia },
        },
        create: {
          assinaturaId: assinatura.id,
          contaId: assinatura.contaId,
          competencia,
          vencimento,
          valorCentavos: reaisParaCentavos(pagamento.value),
          gatewayCobrancaId: pagamento.id,
          linkPagamento: pagamento.invoiceUrl ?? null,
        },
        update: { gatewayCobrancaId: pagamento.id },
        select: { id: true, assinaturaId: true },
      });
      return criada;
    });
  }

  /**
   * De qual assinatura é este pagamento.
   *
   * Três caminhos, em ordem de confiança: a `subscription` do gateway, a nossa
   * `externalReference` (que viaja no objeto) e, por último, o cliente. O
   * último existe pelo Pix Automático, cujas cobranças nascem da autorização e
   * nem sempre carregam a assinatura.
   */
  private async acharAssinatura(
    pagamento: PagamentoAsaas,
  ): Promise<{ id: string; contaId: string } | null> {
    const selecao = { id: true, contaId: true };

    if (pagamento.subscription) {
      const porAssinatura = await this.prisma.assinatura.findFirst({
        where: { gatewayAssinaturaId: pagamento.subscription },
        select: selecao,
      });
      if (porAssinatura) return porAssinatura;
    }

    if (pagamento.externalReference) {
      const porReferencia = await this.prisma.assinatura.findFirst({
        where: { id: pagamento.externalReference },
        select: selecao,
      });
      if (porReferencia) return porReferencia;
    }

    if (pagamento.customer) {
      // O cliente do gateway é um por empresa, então isto só é ambíguo se a
      // empresa tiver duas assinaturas vivas — o que o service impede.
      return this.prisma.assinatura.findFirst({
        where: {
          gatewayClienteId: pagamento.customer,
          status: { in: ["AGUARDANDO", "ATIVA", "INADIMPLENTE"] },
        },
        select: selecao,
        orderBy: { criadoEm: "desc" },
      });
    }

    return null;
  }

  /**
   * O primeiro pagamento é o que tira a assinatura de AGUARDANDO.
   *
   * No Pix Automático ele é literalmente o consentimento: o cliente pagou o QR
   * e, ao pagar, autorizou o banco a deixar as próximas caírem sozinhas. No
   * cartão é a primeira captura. Nos dois casos, antes disso não havia nada
   * ativo — e a tela que dissesse "ativa" estaria mentindo.
   */
  private async marcarPrimeiroPagamento(assinaturaId: string): Promise<void> {
    await comoSistema(async () => {
      const a = await this.prisma.assinatura.findFirst({
        where: { id: assinaturaId },
        select: { status: true, inicioEm: true },
      });
      if (!a || a.status !== "AGUARDANDO") return;
      await this.prisma.assinatura.update({
        where: { id: assinaturaId },
        data: { status: "ATIVA", inicioEm: a.inicioEm ?? new Date() },
      });
      this.log.log(`Assinatura ${assinaturaId} autorizada pelo primeiro pagamento.`);
    });
  }
}

/**
 * Quando o dinheiro entrou, ao meio-dia UTC.
 *
 * O gateway manda só a data ("2026-09-10"). Ancorar na meia-noite faria o
 * pagamento aparecer no dia anterior pra quem lê em São Paulo (UTC-3) — o
 * meio-dia sobrevive a qualquer fuso do Brasil.
 */
function dataDoPagamento(p: PagamentoAsaas): Date {
  const ymd = p.paymentDate ?? p.clientPaymentDate;
  return ymd ? new Date(`${ymd.slice(0, 10)}T12:00:00.000Z`) : new Date();
}
