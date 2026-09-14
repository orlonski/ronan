import { Injectable, Logger } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  competenciaDe,
  formaDoGateway,
  hojeData,
  statusDoGateway,
} from "../common/assinatura-cobranca";
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
    // O Pix Automático tem um ciclo de vida PRÓPRIO, que não passa pelos
    // eventos de cobrança: a autorização é criada, o cliente paga o primeiro
    // QR, e só então ela é ATIVADA. Sem tratar isto, uma assinatura de Pix
    // Automático fica "aguardando autorização" para sempre — mesmo com o
    // dinheiro já na conta. Foi exatamente o que aconteceu no primeiro teste
    // real (14/09/2026): o pagamento entrou, o `PAYMENT_RECEIVED` chegou solto
    // (sem assinatura nem referência) e a ativação nunca foi contada.
    if (tipo.startsWith("PIX_AUTOMATIC_RECURRING_AUTHORIZATION")) {
      return this.aplicarAutorizacaoPix(tipo, payload);
    }

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
      // conta do gateway for usada pra outra coisa — ignorar é o certo, porque
      // casar no chute seria pior.
      //
      // MAS: dinheiro RECEBIDO que não acha dono não pode passar em silêncio.
      // Sem isto, um pagamento órfão fica indistinguível de um evento
      // irrelevante — o cliente pagou e não consta, e ninguém descobre.
      //
      // O `throw` aqui NÃO chega ao gateway: `receber` o captura, carimba o
      // `erro` na linha do evento e o controller responde 200 assim mesmo. Ou
      // seja, a fila continua andando e fica um alarme no banco — que é o que
      // a consulta de diagnóstico procura (ver docs/assinaturas-asaas.md).
      const detalhe = "pagamento sem assinatura conhecida";
      if (novoStatus === "CONFIRMADA" || novoStatus === "RECEBIDA") {
        // Órfão ESPERADO: o pagamento do QR que ativa um Pix Automático sempre
        // chega assim, e é a ATIVAÇÃO (segundos depois) que o registra. Alarmar
        // aqui tocaria em toda assinatura nova — e alarme que toca à toa é
        // alarme que ninguém olha, que foi o motivo de existir este filtro.
        if (await this.temPixAutomaticoEsperandoAutorizacao()) {
          this.log.log(
            `Pagamento ${pagamento.id} chegou sem dono, mas há Pix Automático aguardando ` +
              `autorização — a ativação é que vai registrá-lo.`,
          );
          return { status: "ignorado", detalhe: "provável pagamento de ativação" };
        }

        this.log.error(
          `DINHEIRO SEM DONO: ${pagamento.id} (${formatarValor(pagamento.value)}) foi ` +
            `${novoStatus} e não casou com assinatura nenhuma. Confira no gateway.`,
        );
        throw new Error(`Pagamento ${pagamento.id} recebido sem assinatura correspondente`);
      }
      return { status: "ignorado", detalhe };
    }

    const pago = novoStatus === "CONFIRMADA" || novoStatus === "RECEBIDA";

    // Nunca REBAIXAR uma cobrança já paga.
    //
    // O caso real: a mensalidade de ativação é registrada como recebida, e
    // depois o gateway gera uma cobrança na mesma competência. O
    // `PAYMENT_CREATED` dela chega como PENDENTE e, sem esta trava,
    // sobrescreveria o pagamento — a régua voltaria a cobrar quem já pagou e o
    // cliente receberia aviso de uma dívida que não existe.
    //
    // Estorno e chargeback CONTINUAM passando: eles são a notícia de que o
    // dinheiro voltou, e essa precisa valer. O que não passa é "pendente"
    // depois de "pago".
    const jaPaga = cobranca.status === "CONFIRMADA" || cobranca.status === "RECEBIDA";
    if (jaPaga && (novoStatus === "PENDENTE" || novoStatus === "VENCIDA")) {
      this.log.warn(
        `${tipo}: cobrança ${cobranca.id} já está paga — ignorei o rebaixamento para ${novoStatus}.`,
      );
      return { status: "ignorado", detalhe: "cobrança já paga; rebaixamento recusado" };
    }

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
          // Contestação é diferente de estorno, ainda que o gateway devolva os
          // dois como "estornado". Carimbar aqui é o que permite a tela
          // sinalizar — e é o que impede o caso sumir em silêncio, que era o
          // que acontecia: o dinheiro saía da conta e a assinatura continuava
          // "ativa, nada em aberto".
          contestadaEm: ehContestacao(pagamento.status) ? new Date() : undefined,
        },
      }),
    );

    if (pago) await this.marcarPrimeiroPagamento(cobranca.assinaturaId);
    await this.assinaturas.reavaliarInadimplencia(cobranca.assinaturaId);

    this.log.log(`${tipo}: cobrança ${cobranca.id} → ${novoStatus}`);
    return { status: "processado" };
  }

  /**
   * Existe alguma autorização de Pix Automático esperando o primeiro pagamento?
   *
   * É a pergunta que separa "dinheiro perdido" de "dinheiro a caminho do lugar
   * certo". O pagamento do QR de ativação sempre chega órfão; se há uma
   * assinatura esperando autorização, ele quase certamente é esse — e a
   * ativação, que vem logo atrás, o registra.
   *
   * A janela de 48h evita que uma assinatura esquecida em AGUARDANDO (o cliente
   * nunca pagou) sirva de desculpa para sempre: passado esse tempo, pagamento
   * órfão volta a ser alarme.
   */
  private async temPixAutomaticoEsperandoAutorizacao(): Promise<boolean> {
    const desde = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const quantas = await comoSistema(() =>
      this.prisma.assinatura.count({
        where: { status: "AGUARDANDO", forma: "PIX_AUTOMATICO", criadoEm: { gte: desde } },
      }),
    );
    return quantas > 0;
  }

  /**
   * O ciclo de vida da autorização de Pix Automático.
   *
   * A autorização é o consentimento que o cliente deu no app do banco dele. É
   * ela, e não a cobrança, que decide se a recorrência existe: sem autorização
   * ativa, nenhuma parcela futura é debitada.
   *
   * ⚠️ Estes eventos NÃO vêm na categoria "Cobranças" do webhook — precisam ser
   * marcados à parte no painel do gateway. Um webhook que só assina cobranças
   * recebe o dinheiro do primeiro Pix e nunca fica sabendo da ativação.
   */
  private async aplicarAutorizacaoPix(
    tipo: string,
    payload: unknown,
  ): Promise<{ status: "processado" | "ignorado"; detalhe?: string }> {
    const autorizacao = extrairAutorizacao(payload);
    if (!autorizacao?.id) {
      return { status: "ignorado", detalhe: "evento de autorização sem id" };
    }

    const assinatura = await comoSistema(() =>
      this.prisma.assinatura.findFirst({
        where: { gatewayAutorizacaoId: autorizacao.id },
        select: { id: true, status: true, inicioEm: true },
      }),
    );
    if (!assinatura) {
      return { status: "ignorado", detalhe: "autorização de assinatura desconhecida" };
    }
    if (assinatura.status === "CANCELADA") {
      return { status: "ignorado", detalhe: "assinatura já cancelada" };
    }

    if (tipo.endsWith("_ACTIVATED")) {
      await comoSistema(() =>
        this.prisma.assinatura.update({
          where: { id: assinatura.id },
          data: { status: "ATIVA", inicioEm: assinatura.inicioEm ?? new Date() },
        }),
      );
      await this.registrarPagamentoDeAtivacao(assinatura.id);
      this.log.log(`Autorização ${autorizacao.id} ativada: assinatura ${assinatura.id} está valendo.`);
      return { status: "processado" };
    }

    // Recusada, cancelada no app do banco ou vencida sem o primeiro pagamento:
    // não há mais como cobrar por este caminho. A assinatura para — e SÓ ela:
    // o acesso da empresa continua, como em todo cancelamento.
    if (tipo.endsWith("_REFUSED") || tipo.endsWith("_CANCELLED") || tipo.endsWith("_EXPIRED")) {
      const motivo = tipo.endsWith("_REFUSED")
        ? "O cliente recusou a autorização do Pix Automático no banco dele."
        : tipo.endsWith("_CANCELLED")
          ? "A autorização do Pix Automático foi cancelada no banco do cliente."
          : "A autorização do Pix Automático venceu sem o primeiro pagamento.";

      await comoSistema(() =>
        this.prisma.assinatura.update({
          where: { id: assinatura.id },
          data: { status: "CANCELADA", canceladaEm: new Date(), motivoCancelamento: motivo },
        }),
      );
      this.log.warn(`Autorização ${autorizacao.id} encerrada (${tipo}): ${motivo}`);
      return { status: "processado" };
    }

    // CREATED e o que o gateway inventar depois: guardado, sem efeito. A
    // criação já foi registrada quando NÓS a criamos.
    return { status: "ignorado", detalhe: `evento de autorização sem efeito: ${tipo}` };
  }

  /**
   * A mensalidade que o cliente pagou no QR inicial, registrada como recebida.
   *
   * **Por que isto existe, e por que é obrigatório.** No Pix Automático o
   * cliente paga um QR pra autorizar a recorrência — e esse pagamento É a
   * primeira mensalidade, no valor dela. Só que ele chega invisível: sem
   * `subscription`, sem `externalReference`, e com um `customer` que é o
   * PAGADOR (se ele paga da conta pessoa física, é outro documento e outro
   * cliente no gateway). Nenhum dos caminhos de casamento serve, e o
   * `PAYMENT_RECEIVED` é descartado como órfão — corretamente, porque casar no
   * chute seria pior.
   *
   * O efeito, sem isto: o cliente paga a primeira mensalidade, o dinheiro entra
   * na conta, e o sistema não sabe. A receita some do fechamento e, quando ele
   * perguntar "paguei, por que consta em aberto?", não há resposta. Dinheiro
   * que entra e não é registrado é o pior tipo de erro: silencioso e contra
   * quem pagou.
   *
   * Quem conta que o pagamento aconteceu é o evento de ATIVAÇÃO — a autorização
   * só vira ativa DEPOIS que o primeiro Pix liquida. Então a ativação é prova
   * suficiente de recebimento, e é dela que esta linha nasce.
   *
   * Idempotente por construção: a chave (assinatura, competência) impede que um
   * reenvio do evento crie uma segunda mensalidade do mesmo mês. E se a
   * competência já existir — porque o pagamento casou por outro caminho —, esta
   * função NÃO mexe nela: o que veio do gateway, com id e valor de verdade,
   * vale mais que o que a gente deduz.
   */
  private async registrarPagamentoDeAtivacao(assinaturaId: string): Promise<void> {
    await comoSistema(async () => {
      const assinatura = await this.prisma.assinatura.findFirst({
        where: { id: assinaturaId },
        select: { id: true, contaId: true, valorCentavos: true },
      });
      if (!assinatura) return;

      const agora = new Date();
      const competencia = competenciaDe(agora);

      const jaExiste = await this.prisma.cobrancaAssinatura.findUnique({
        where: { assinaturaId_competencia: { assinaturaId, competencia } },
        select: { id: true, status: true },
      });
      if (jaExiste) {
        this.log.log(
          `Ativação de ${assinaturaId}: a competência já tinha cobrança (${jaExiste.status}) — não mexi.`,
        );
        return;
      }

      await this.prisma.cobrancaAssinatura.create({
        data: {
          assinaturaId,
          contaId: assinatura.contaId,
          competencia,
          // Venceu e foi paga no mesmo dia: é o pagamento que ativou tudo.
          vencimento: hojeData(agora),
          status: "RECEBIDA",
          valorCentavos: assinatura.valorCentavos,
          valorPagoCentavos: assinatura.valorCentavos,
          pagoEm: agora,
          formaPaga: "PIX",
          pagamentoDeAtivacao: true,
        },
      });

      this.log.log(
        `Ativação de ${assinaturaId}: mensalidade de ${competencia.toISOString().slice(0, 7)} registrada como paga.`,
      );
    });
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
  ): Promise<{ id: string; assinaturaId: string; status: string } | null> {
    return comoSistema(async () => {
      const existente = await this.prisma.cobrancaAssinatura.findUnique({
        where: { gatewayCobrancaId: pagamento.id },
        select: { id: true, assinaturaId: true, status: true },
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
        select: { id: true, assinaturaId: true, status: true },
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

    // A autorização primeiro, quando o pagamento diz de qual ela veio: no Pix
    // Automático é o vínculo mais forte que existe, e o único que sobrevive ao
    // primeiro pagamento — que chega SEM `subscription` e SEM
    // `externalReference`, porque o gateway o registra como um Pix avulso.
    if (pagamento.pixAutomaticAuthorizationId) {
      const porAutorizacao = await this.prisma.assinatura.findFirst({
        where: { gatewayAutorizacaoId: pagamento.pixAutomaticAuthorizationId },
        select: selecao,
      });
      if (porAutorizacao) return porAutorizacao;
    }

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

/**
 * O objeto da autorização dentro do evento.
 *
 * Lê mais de uma chave de propósito: a documentação do gateway descreve os
 * campos da autorização mas não fixa, de forma inequívoca, sob qual chave ela
 * viaja no webhook. Já pagamos uma vez por assumir um formato sem confirmar —
 * o copia-e-cola do QR, que era `payload` na raiz e não dentro de
 * `immediateQrCode`. Aqui o custo de tentar três chaves é zero, e o custo de
 * errar é uma assinatura que nunca ativa.
 */
export function extrairAutorizacao(payload: unknown): { id?: string; status?: string } | null {
  const p = payload as Record<string, unknown> | undefined;
  if (!p) return null;
  for (const chave of [
    "authorization",
    "pixAutomaticRecurringAuthorization",
    "pixAutomaticAuthorization",
    "recurringAuthorization",
  ]) {
    const v = p[chave];
    if (v && typeof v === "object" && typeof (v as { id?: unknown }).id === "string") {
      return v as { id?: string; status?: string };
    }
  }
  // Último caso: o id solto na raiz, que é como alguns eventos simples chegam.
  if (typeof p.id === "string" && typeof p.event === "string" && p.payment === undefined) {
    const id = p.id;
    // O `id` da RAIZ costuma ser o do evento ("evt_..."), não o da autorização.
    // Só serve se não parecer um id de evento.
    if (!id.startsWith("evt_")) return { id };
  }
  return null;
}

/** "R$ 1.890,00" — só pra mensagem de log ficar legível por gente. */
function formatarValor(reais: number): string {
  return reais.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/**
 * Este status é o cliente CONTESTANDO, não você devolvendo?
 *
 * A diferença decide o que o sistema faz. Estorno é devolução intencional e
 * encerra o assunto; contestação é uma disputa em curso em que o dinheiro saiu
 * da sua conta e a mensalidade continua devida — mas que ninguém deve cobrar
 * automaticamente, porque cobrar quem contestou é cobrança contra alguém em
 * disputa formal.
 */
export function ehContestacao(status: string): boolean {
  return (
    status === "CHARGEBACK_REQUESTED" ||
    status === "CHARGEBACK_DISPUTE" ||
    status === "AWAITING_CHARGEBACK_REVERSAL"
  );
}
