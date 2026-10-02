import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AcaoAuditoria, Prisma, type CobrancaCliente, type ConexaoAsaas } from "@prisma/client";
import {
  detectarAmbienteAsaas,
  type ConectarAsaasInput,
  type ConexaoAsaasResumo,
} from "@ronan/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { AuditoriaService } from "../auditoria/auditoria.service";
import { AdminInboxService } from "../admin/inbox/inbox.service";
import { ErroGateway } from "../assinaturas/gateway.types";
import { segredoDeCripto } from "../common/segredo-cripto";
import { apurarTitulo } from "../common/financeiro";
import { inicioDoDiaData, ymdSaoPaulo } from "../common/timezone";
import { comConta } from "../common/conta/conta-context";
import { baseUrlAsaas, ClienteAsaasConta, type PagamentoAsaasCliente } from "./asaas-conta.cliente";
import {
  decidirEvento,
  documentoDoCliente,
  eventoDoStatusAsaas,
  meioDoBillingType,
  reaisDoAsaas,
  vencimentoDaCobranca,
  type DecisaoEvento,
} from "./cobranca-cliente.regras";
import {
  cifrarChaveAsaas,
  decifrarChaveAsaas,
  finalDaChave,
  hashTokenWebhook,
  novoTokenWebhook,
} from "./segredo-asaas";

/** Os eventos que o webhook da transportadora assina. Só pagamento: o resto da conta dela não é da nossa conta. */
const EVENTOS_WEBHOOK = [
  "PAYMENT_CREATED",
  "PAYMENT_UPDATED",
  "PAYMENT_CONFIRMED",
  "PAYMENT_RECEIVED",
  "PAYMENT_OVERDUE",
  "PAYMENT_DELETED",
  "PAYMENT_RESTORED",
  "PAYMENT_REFUNDED",
  "PAYMENT_PARTIALLY_REFUNDED",
  "PAYMENT_RECEIVED_IN_CASH_UNDONE",
  "PAYMENT_CHARGEBACK_REQUESTED",
  "PAYMENT_CHARGEBACK_DISPUTE",
  "PAYMENT_DUNNING_RECEIVED",
];

/** Caminho público do webhook. O `:contaId` é o que diz de quem é o evento — a rota não tem JWT. */
export const CAMINHO_WEBHOOK = "cobranca-cliente/webhook/asaas";

/** Uma reserva sem resposta do Asaas há mais que isto é de um processo que morreu no meio. */
const RESERVA_ORFA_MS = 2 * 60_000;

type Envelope = { id?: unknown; event?: unknown; payment?: unknown };

function hojeSP(): string {
  const [a, m, d] = ymdSaoPaulo();
  return `${a}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function diaUtc(iso: string): Date {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`);
}

function brl(v: Prisma.Decimal | string | number): string {
  return Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/**
 * Boleto/Pix da fatura do cliente pela conta Asaas DA TRANSPORTADORA, com
 * baixa automática pelo webhook.
 *
 * Três coisas que este service nunca faz, de propósito:
 * - **usar a chave da Movatruck** (`ASAAS_API_KEY`): essa é da mensalidade. A
 *   chave aqui é sempre a da conta, decifrada na hora e descartada.
 * - **escrever o status do título à mão**: o pagamento confirmado vira uma
 *   `BaixaTitulo`, e o título se move pelo mesmo `apurarTitulo` de toda baixa.
 * - **deixar um evento atrasado despagar um título**: ver `decidirEvento`.
 */
@Injectable()
export class CobrancaClienteService {
  private readonly log = new Logger(CobrancaClienteService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly auditoria: AuditoriaService,
    private readonly inbox: AdminInboxService,
  ) {}

  // ------------------------------------------------------------ ambiente

  /**
   * O segredo que cifra as chaves do Asaas.
   *
   * `CHAVE_CIFRA_SEGREDOS` é dedicada a isto. Em produção é OBRIGATÓRIA: sem
   * ela a feature fica indisponível — nunca grava em claro, e nunca pega
   * carona no `JWT_SECRET`, porque rotacionar o segredo do login (pendência
   * conhecida) apagaria em silêncio a conexão de todas as transportadoras.
   * Fora de produção cai no segredo das chaves de IA, pra o dev funcionar sem
   * configurar nada.
   *
   * Não reusa a `CRIPTO_SECRET`: em produção ela pode estar ausente com as
   * chaves de IA cifradas pelo fallback do JWT, e criá-la agora pra esta
   * feature tornaria aquelas ilegíveis.
   */
  private segredo(): string | null {
    const dedicado = this.config.get<string>("CHAVE_CIFRA_SEGREDOS")?.trim();
    if (dedicado && dedicado.length >= 32) return dedicado;
    if (this.emProducao()) return null;
    return segredoDeCripto(this.config);
  }

  private emProducao(): boolean {
    return this.config.get<string>("NODE_ENV") === "production";
  }

  /**
   * URL base do Asaas, com a porta de teste.
   *
   * `ASAAS_URL_BASE_OVERRIDE` existe só pra apontar pra um Asaas falso no
   * teste local, e é IGNORADA em produção: honrá-la lá mandaria a chave de
   * API de um cliente pra qualquer host que alguém escrevesse numa env.
   */
  private baseUrl(ambiente: "SANDBOX" | "PRODUCAO"): string {
    const override = this.emProducao() ? null : this.config.get<string>("ASAAS_URL_BASE_OVERRIDE")?.trim();
    return baseUrlAsaas(ambiente, override || null);
  }

  private urlWebhook(contaId: string): string | null {
    const base = (this.config.get<string>("PUBLIC_API_URL") ?? "").trim().replace(/\/+$/, "");
    return base ? `${base}/${CAMINHO_WEBHOOK}/${contaId}` : null;
  }

  private indisponivel(): string | null {
    if (!this.segredo()) {
      return "O servidor ainda não tem o segredo que protege a chave do Asaas (CHAVE_CIFRA_SEGREDOS). Fale com o suporte da Movatruck.";
    }
    return null;
  }

  private cliente(conexao: Pick<ConexaoAsaas, "chaveCifrada" | "ambiente">): ClienteAsaasConta {
    const segredo = this.segredo();
    if (!segredo) throw new ServiceUnavailableException(this.indisponivel());
    const chave = decifrarChaveAsaas(conexao.chaveCifrada, segredo);
    if (!chave) {
      // Segredo trocado no servidor, ou linha adulterada. Qualquer chamada com
      // lixo daria 401 no Asaas com uma mensagem que não ajuda ninguém.
      throw new ConflictException(
        "Não consegui ler a chave do Asaas guardada. Conecte a conta de novo em Contas a pagar e receber → Cobrança pelo Asaas.",
      );
    }
    return new ClienteAsaasConta({ chave, baseUrl: this.baseUrl(conexao.ambiente) });
  }

  private async conexaoOuFalha(): Promise<ConexaoAsaas> {
    const c = await this.prisma.conexaoAsaas.findFirst({});
    if (!c) {
      throw new ConflictException(
        "A empresa ainda não conectou a conta Asaas. Peça a um administrador pra conectar em Contas a pagar e receber → Cobrança pelo Asaas.",
      );
    }
    return c;
  }

  /** Erro do gateway vira mensagem de tela; o resto segue como veio. */
  private traduzir(e: unknown): never {
    if (e instanceof HttpException) throw e;
    if (e instanceof ErroGateway) {
      // 4xx do Asaas é dado errado (chave recusada, CNPJ inválido): é 400 pra
      // quem está na tela, não falha nossa. Só rede/5xx do gateway é 502.
      if (e.status && e.status < 500 && e.status !== 429) throw new BadRequestException(`Asaas: ${e.message}`);
      throw new BadGatewayException(`Asaas: ${e.message}`);
    }
    throw e;
  }

  // ------------------------------------------------------------ conexão

  async resumo(): Promise<ConexaoAsaasResumo> {
    const motivo = this.indisponivel();
    const c = await this.prisma.conexaoAsaas.findFirst({});
    if (!c) return { conectada: false, disponivel: !motivo, motivoIndisponivel: motivo };
    return {
      conectada: true,
      ambiente: c.ambiente,
      chaveFinal: c.chaveFinal,
      nomeContaAsaas: c.nomeContaAsaas,
      documentoContaAsaas: c.documentoContaAsaas,
      webhookRegistrado: !!c.webhookId && !c.webhookErro,
      webhookErro: c.webhookErro,
      conectadoEm: c.conectadoEm.toISOString(),
      disponivel: !motivo,
      motivoIndisponivel: motivo,
    };
  }

  /** O que a tela do título precisa saber pra mostrar (ou não) o botão. */
  async situacao() {
    const c = await this.prisma.conexaoAsaas.findFirst({ select: { ambiente: true } });
    return { conectada: !!c, ambiente: c?.ambiente ?? null };
  }

  /**
   * Conecta (ou troca) a conta Asaas: testa a chave, guarda cifrada e registra
   * o webhook na conta dela.
   *
   * A chave só é gravada DEPOIS de o Asaas aceitá-la — chave errada não chega
   * no banco. O webhook é tentado em seguida; se falhar, a conexão fica (a
   * cobrança já sai) e a tela mostra que a baixa automática ainda não chega.
   */
  async conectar(input: ConectarAsaasInput, usuario: { id: string; email: string; contaId: string }) {
    const motivo = this.indisponivel();
    if (motivo) throw new ServiceUnavailableException(motivo);
    const segredo = this.segredo()!;

    const chave = input.chave.trim();
    const pelaChave = detectarAmbienteAsaas(chave);
    if (pelaChave && input.ambiente && pelaChave !== input.ambiente) {
      throw new BadRequestException(
        pelaChave === "PRODUCAO"
          ? "Essa chave é de PRODUÇÃO ($aact_prod_), mas foi escolhido o ambiente de teste."
          : "Essa chave é de TESTE ($aact_hmlg_), mas foi escolhido o ambiente de produção.",
      );
    }
    const ambiente = pelaChave ?? input.ambiente;
    if (!ambiente) {
      throw new BadRequestException(
        "Não deu pra saber pela chave se ela é de teste ou de produção. Escolha o ambiente.",
      );
    }

    const cliente = new ClienteAsaasConta({ chave, baseUrl: this.baseUrl(ambiente) });
    let info;
    try {
      info = await cliente.minhaConta();
    } catch (e) {
      this.traduzir(e);
    }

    const anterior = await this.prisma.conexaoAsaas.findFirst({});

    // Trocar de CONTA Asaas com boleto em aberto deixaria esses boletos órfãos:
    // a chave nova não enxerga os pagamentos da conta velha, e o webhook da
    // conta velha some. Trocar a CHAVE da mesma conta (rotação) é livre.
    if (anterior?.documentoContaAsaas && info.documento && anterior.documentoContaAsaas !== info.documento) {
      const vivas = await this.prisma.cobrancaCliente.count({ where: { status: { in: ["PENDENTE", "VENCIDA"] } } });
      if (vivas > 0) {
        throw new ConflictException(
          `Essa chave é de outra conta Asaas, e há ${vivas} cobrança(s) em aberto na conta atual. Cancele ou receba essas cobranças antes de trocar de conta.`,
        );
      }
    }

    const token = novoTokenWebhook();
    const dados = {
      ambiente,
      chaveCifrada: cifrarChaveAsaas(chave, segredo),
      chaveFinal: finalDaChave(chave),
      nomeContaAsaas: info.nome,
      documentoContaAsaas: info.documento,
      webhookTokenHash: hashTokenWebhook(token),
      webhookId: null as string | null,
      webhookErro: null as string | null,
      conectadoPorId: usuario.id,
      conectadoEm: new Date(),
    };

    // O webhook antigo sai antes do novo entrar: dois webhooks na mesma conta
    // mandariam cada evento duas vezes (um deles com o token velho, recusado).
    const { webhookId, erro } = await this.registrarWebhook(cliente, usuario.contaId, usuario.email, token, anterior?.webhookId);
    dados.webhookId = webhookId;
    dados.webhookErro = erro;

    if (anterior) {
      await this.prisma.conexaoAsaas.update({ where: { id: anterior.id }, data: dados });
    } else {
      await this.prisma.conexaoAsaas.create({ data: dados });
    }

    await this.auditoria.log({
      usuarioId: usuario.id,
      entidade: "ConexaoAsaas",
      entidadeId: usuario.contaId,
      acao: AcaoAuditoria.UPDATE,
      campo: "conexao",
      // Nunca a chave: só o que ajuda a reconhecer depois.
      valorAntes: anterior ? { conta: anterior.nomeContaAsaas, final: anterior.chaveFinal, ambiente: anterior.ambiente } : null,
      valorDepois: { conta: info.nome, final: dados.chaveFinal, ambiente, webhook: erro ? "falhou" : "registrado" },
      motivo: anterior ? "Conta Asaas trocada" : "Conta Asaas conectada",
    });

    return this.resumo();
  }

  /** Tenta de novo só o webhook (ex.: PUBLIC_API_URL configurada depois). */
  async reregistrarWebhook(usuario: { id: string; email: string; contaId: string }) {
    const c = await this.conexaoOuFalha();
    const cliente = this.cliente(c);
    const token = novoTokenWebhook();
    const { webhookId, erro } = await this.registrarWebhook(cliente, usuario.contaId, usuario.email, token, c.webhookId);
    await this.prisma.conexaoAsaas.update({
      where: { id: c.id },
      data: { webhookId, webhookErro: erro, webhookTokenHash: hashTokenWebhook(token) },
    });
    return this.resumo();
  }

  private async registrarWebhook(
    cliente: ClienteAsaasConta,
    contaId: string,
    email: string,
    token: string,
    webhookAnterior: string | null | undefined,
  ): Promise<{ webhookId: string | null; erro: string | null }> {
    const url = this.urlWebhook(contaId);
    if (!url) {
      return {
        webhookId: null,
        erro: "O servidor não tem PUBLIC_API_URL configurada, então o Asaas não tem pra onde avisar dos pagamentos.",
      };
    }
    try {
      if (webhookAnterior) await cliente.removerWebhook(webhookAnterior);
      // Sobra de uma conexão anterior que não chegou a gravar o id: mesma URL = nosso.
      for (const w of await cliente.listarWebhooks()) {
        if (w.url === url && w.id !== webhookAnterior) await cliente.removerWebhook(w.id);
      }
      const criado = await cliente.criarWebhook({
        nome: "Movatruck — baixa automática das faturas",
        url,
        email,
        authToken: token,
        eventos: EVENTOS_WEBHOOK,
      });
      return { webhookId: criado.id, erro: null };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.log.warn(`Webhook não registrado na conta ${contaId}: ${msg}`);
      return { webhookId: null, erro: `O Asaas não aceitou o webhook: ${msg}` };
    }
  }

  async desconectar(usuarioId: string) {
    const c = await this.prisma.conexaoAsaas.findFirst({});
    if (!c) return { ok: true };
    // Best-effort: tirar nosso webhook da conta dela. Se a chave já foi
    // revogada lá, não há o que remover — e isso não pode prender a conexão.
    if (c.webhookId) {
      try {
        await this.cliente(c).removerWebhook(c.webhookId);
      } catch (e) {
        this.log.warn(`Não removi o webhook ao desconectar: ${(e as Error).message}`);
      }
    }
    await this.prisma.conexaoAsaas.delete({ where: { id: c.id } });
    await this.auditoria.log({
      usuarioId,
      entidade: "ConexaoAsaas",
      entidadeId: c.contaId,
      acao: AcaoAuditoria.DELETE,
      campo: "conexao",
      valorAntes: { conta: c.nomeContaAsaas, final: c.chaveFinal, ambiente: c.ambiente },
      motivo: "Conta Asaas desconectada",
    });
    return { ok: true };
  }

  // ------------------------------------------------------------ emitir

  /**
   * Gera o boleto/Pix de um título. Idempotente em três camadas:
   *
   * 1. `tituloAtivoId @unique`: dois cliques simultâneos não reservam duas vagas.
   * 2. Se já existe cobrança viva, devolve ela em vez de criar outra.
   * 3. Antes de criar no Asaas, procura lá por cobrança viva com
   *    `externalReference` = id do título. Cobre o caso em que o Asaas criou e
   *    a gente morreu antes de gravar — sem isto, o retry geraria um segundo
   *    boleto pro cliente pagar.
   */
  async emitir(tituloId: string, usuarioId: string): Promise<CobrancaCliente> {
    const conexao = await this.conexaoOuFalha();
    const titulo = await this.prisma.tituloReceber.findUnique({
      where: { id: tituloId },
      include: {
        baixas: { select: { valor: true } },
        empresa: { select: { id: true, nome: true, razaoSocial: true, cnpj: true, email: true } },
        fatura: { select: { numero: true, _count: { select: { titulos: true } } } },
      },
    });
    if (!titulo) throw new NotFoundException("Título não encontrado");
    if (titulo.status === "CANCELADO") throw new ConflictException("Esse título foi cancelado.");

    const viva = await this.prisma.cobrancaCliente.findUnique({ where: { tituloAtivoId: tituloId } });
    if (viva?.asaasPaymentId) return viva;
    if (viva && Date.now() - viva.criadoEm.getTime() < RESERVA_ORFA_MS) {
      throw new ConflictException("A cobrança desse título está sendo gerada agora. Espere alguns segundos.");
    }

    const { saldo } = apurarTitulo(titulo.valor, titulo.baixas, titulo.status);
    if (new Prisma.Decimal(saldo).lte(0)) throw new ConflictException("Esse título já está quitado.");

    const documento = documentoDoCliente(titulo.empresa.cnpj);
    if (!documento) {
      throw new BadRequestException(
        `O cliente ${titulo.empresa.nome} está sem CNPJ/CPF válido no cadastro. O Asaas não emite boleto sem documento — complete em Clientes.`,
      );
    }

    const vencimento = vencimentoDaCobranca(titulo.vencimento.toISOString().slice(0, 10), hojeSP());

    // Reserva a vaga (ou reaproveita uma reserva órfã de um processo que morreu).
    let reserva: CobrancaCliente;
    if (viva) {
      reserva = viva;
    } else {
      try {
        reserva = await this.prisma.cobrancaCliente.create({
          data: {
            tituloReceberId: tituloId,
            tituloAtivoId: tituloId,
            ambiente: conexao.ambiente,
            valor: saldo,
            vencimento: diaUtc(vencimento),
            criadoPorId: usuarioId,
          },
        });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
          const outra = await this.prisma.cobrancaCliente.findUnique({ where: { tituloAtivoId: tituloId } });
          if (outra?.asaasPaymentId) return outra;
          throw new ConflictException("A cobrança desse título está sendo gerada agora. Espere alguns segundos.");
        }
        throw e;
      }
    }

    const cliente = this.cliente(conexao);
    let pagamento: PagamentoAsaasCliente;
    let customerId: string;
    try {
      customerId = await cliente.garantirCliente({
        nome: titulo.empresa.razaoSocial?.trim() || titulo.empresa.nome,
        documento,
        email: titulo.empresa.email,
        referencia: titulo.empresa.id,
      });
      let existente = await cliente.cobrancaVivaDaReferencia(tituloId);
      // Só serve a que ainda não é de outra linha nossa: uma cobrança que a
      // gente já deu por morta (estornada/cancelada aqui) e que o Asaas ainda
      // lista como aberta não pode renascer amarrada a esta reserva.
      if (existente) {
        const dona = await this.prisma.cobrancaCliente.findFirst({
          where: { asaasPaymentId: existente.id, id: { not: reserva.id } },
          select: { id: true },
        });
        if (dona) existente = null;
      }
      const parcelas = titulo.fatura?._count.titulos ?? 1;
      pagamento =
        existente ??
        (await cliente.criarCobranca({
          cliente: customerId,
          valor: saldo,
          vencimento,
          descricao: titulo.fatura
            ? `Fatura ${titulo.fatura.numero}` + (parcelas > 1 ? ` — parcela ${titulo.parcela} de ${parcelas}` : "")
            : `Título a receber — parcela ${titulo.parcela}`,
          referencia: tituloId,
        }));
    } catch (e) {
      // Nada foi criado no Asaas (ou não sabemos o id): solta a vaga pra a
      // pessoa poder tentar de novo. O passo 3 acima cobre o "criou e não soube".
      await this.prisma.cobrancaCliente.delete({ where: { id: reserva.id } }).catch(() => undefined);
      this.traduzir(e);
    }

    const [linha, pix] = await Promise.all([cliente.linhaDigitavel(pagamento.id), cliente.pixCopiaCola(pagamento.id)]);

    const cobranca = await this.prisma.cobrancaCliente.update({
      where: { id: reserva.id },
      data: {
        asaasPaymentId: pagamento.id,
        asaasCustomerId: customerId,
        valor: reaisDoAsaas(pagamento.value) ?? saldo,
        vencimento: pagamento.dueDate ? diaUtc(pagamento.dueDate) : diaUtc(vencimento),
        linkFatura: pagamento.invoiceUrl ?? null,
        linhaDigitavel: linha ?? pagamento.identificationField ?? null,
        pixCopiaCola: pix,
        status: pagamento.status === "OVERDUE" ? "VENCIDA" : "PENDENTE",
      },
    });

    await this.auditoria.log({
      usuarioId,
      entidade: "TituloReceber",
      entidadeId: tituloId,
      acao: AcaoAuditoria.UPDATE,
      campo: "cobranca-asaas",
      valorDepois: { cobranca: pagamento.id, valor: cobranca.valor.toString(), vencimento, ambiente: conexao.ambiente },
      motivo: `Boleto/Pix gerado no Asaas (${brl(cobranca.valor)})`,
    });
    return cobranca;
  }

  /** "Gerar para todas as parcelas": uma por vez, e uma que falha não impede as outras. */
  async emitirFatura(faturaId: string, usuarioId: string) {
    const fatura = await this.prisma.fatura.findUnique({
      where: { id: faturaId },
      select: { id: true, titulos: { select: { id: true, parcela: true, status: true }, orderBy: { parcela: "asc" } } },
    });
    if (!fatura) throw new NotFoundException("Fatura não encontrada");
    const resultados: { tituloId: string; parcela: number; ok: boolean; erro?: string }[] = [];
    for (const t of fatura.titulos) {
      if (t.status === "PAGO" || t.status === "CANCELADO") continue;
      try {
        await this.emitir(t.id, usuarioId);
        resultados.push({ tituloId: t.id, parcela: t.parcela, ok: true });
      } catch (e) {
        resultados.push({ tituloId: t.id, parcela: t.parcela, ok: false, erro: (e as Error).message });
      }
    }
    return { resultados };
  }

  async cancelar(cobrancaId: string, usuarioId: string) {
    const cob = await this.prisma.cobrancaCliente.findUnique({ where: { id: cobrancaId } });
    if (!cob) throw new NotFoundException("Cobrança não encontrada");
    if (cob.status === "CANCELADA") return cob;
    if (cob.status !== "PENDENTE" && cob.status !== "VENCIDA") {
      throw new ConflictException(
        cob.status === "PAGA"
          ? "Essa cobrança já foi paga. Pra devolver o dinheiro, faça o estorno no Asaas — a baixa se desfaz sozinha."
          : "Essa cobrança não está mais em aberto.",
      );
    }
    if (cob.asaasPaymentId) {
      const conexao = await this.conexaoOuFalha();
      try {
        await this.cliente(conexao).cancelarCobranca(cob.asaasPaymentId);
      } catch (e) {
        this.traduzir(e);
      }
    }
    const feita = await this.prisma.cobrancaCliente.update({
      where: { id: cob.id },
      data: { status: "CANCELADA", tituloAtivoId: null },
    });
    await this.auditoria.log({
      usuarioId,
      entidade: "TituloReceber",
      entidadeId: cob.tituloReceberId,
      acao: AcaoAuditoria.UPDATE,
      campo: "cobranca-asaas",
      valorAntes: { cobranca: cob.asaasPaymentId, status: cob.status },
      valorDepois: { status: "CANCELADA" },
      motivo: "Cobrança do Asaas cancelada pelo painel",
    });
    return feita;
  }

  /**
   * Confere no Asaas e aplica o que mudou — a rede de segurança de webhook
   * perdido (URL errada, fila interrompida). Passa pela MESMA decisão do
   * webhook: conferir à mão não tem poder de despagar nada.
   */
  async sincronizar(cobrancaId: string) {
    const cob = await this.prisma.cobrancaCliente.findUnique({ where: { id: cobrancaId } });
    if (!cob) throw new NotFoundException("Cobrança não encontrada");
    if (!cob.asaasPaymentId) throw new ConflictException("Essa cobrança ainda não chegou ao Asaas.");
    const conexao = await this.conexaoOuFalha();
    let pagamento: PagamentoAsaasCliente | null;
    try {
      pagamento = await this.cliente(conexao).buscarCobranca(cob.asaasPaymentId);
    } catch (e) {
      this.traduzir(e);
    }
    const evento = pagamento ? eventoDoStatusAsaas(pagamento.status, pagamento.deleted) : "PAYMENT_DELETED";
    if (!evento) return { resultado: `status "${pagamento?.status}" sem efeito`, cobranca: cob };
    const r = await this.aplicar(cob.id, evento, pagamento ?? ({ id: cob.asaasPaymentId } as PagamentoAsaasCliente));
    return { resultado: r, cobranca: await this.prisma.cobrancaCliente.findUnique({ where: { id: cob.id } }) };
  }

  // ------------------------------------------------------------ webhook

  /**
   * Um evento do Asaas da conta `contaId`, já autenticado pelo guard.
   *
   * Guarda o cru antes de aplicar; `(contaId, eventoId)` único absorve o
   * reenvio. Nunca lança pra fora: o controller responde 200 sempre, porque
   * erro faz o Asaas reenviar e 15 falhas seguidas INTERROMPEM a fila da
   * transportadora inteira.
   */
  async receberEvento(contaId: string, corpo: Envelope): Promise<{ status: string }> {
    return comConta(contaId, async () => {
      const eventoId = typeof corpo?.id === "string" ? corpo.id : null;
      const tipo = typeof corpo?.event === "string" ? corpo.event : null;
      const pagamento =
        corpo?.payment && typeof corpo.payment === "object" ? (corpo.payment as PagamentoAsaasCliente) : null;
      if (!eventoId || !tipo) return { status: "ignorado" };

      let registro;
      try {
        registro = await this.prisma.eventoCobrancaCliente.create({
          data: {
            eventoId,
            tipo,
            asaasPaymentId: pagamento?.id ?? null,
            payload: corpo as Prisma.InputJsonValue,
          },
        });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { status: "duplicado" };
        throw e;
      }

      let resultado: string;
      let cobrancaId: string | null = null;
      try {
        if (!tipo.startsWith("PAYMENT_") || !pagamento?.id) {
          resultado = "ignorado: não é evento de cobrança";
        } else {
          const cob = await this.cobrancaDoPagamento(pagamento, tipo);
          if (!cob) {
            resultado = "ignorado: cobrança que não saiu do Movatruck";
          } else {
            cobrancaId = cob.id;
            resultado = await this.aplicar(cob.id, tipo, pagamento);
          }
        }
      } catch (e) {
        resultado = `falhou: ${(e as Error).message}`.slice(0, 500);
        this.log.error(`Evento ${eventoId} (${tipo}) da conta ${contaId} não aplicado: ${(e as Error).message}`);
      }
      await this.prisma.eventoCobrancaCliente.update({
        where: { id: registro.id },
        data: { resultado, cobrancaClienteId: cobrancaId },
      });
      return { status: resultado.startsWith("falhou") ? "falhou" : resultado.startsWith("ignorado") ? "ignorado" : "aplicado" };
    });
  }

  /**
   * A nossa cobrança deste pagamento. Se não acharmos pelo id, mas o
   * `externalReference` for um título DESTA conta e o evento disser que o
   * dinheiro entrou, adota: é o caso em que o Asaas criou a cobrança e a gente
   * caiu antes de gravar o id. Recebimento não pode se perder por isso.
   */
  private async cobrancaDoPagamento(p: PagamentoAsaasCliente, tipo: string) {
    const achada = await this.prisma.cobrancaCliente.findFirst({ where: { asaasPaymentId: p.id } });
    if (achada) return achada;
    if (!p.externalReference || decidirEvento("PENDENTE", tipo).acao !== "baixar") return null;
    const titulo = await this.prisma.tituloReceber.findUnique({
      where: { id: p.externalReference },
      select: { id: true },
    });
    if (!titulo) return null;
    const conexao = await this.prisma.conexaoAsaas.findFirst({ select: { ambiente: true } });
    // Reserva órfã do mesmo título (sem id do Asaas) vira esta cobrança.
    const orfa = await this.prisma.cobrancaCliente.findFirst({
      where: { tituloAtivoId: titulo.id, asaasPaymentId: null },
    });
    if (orfa) {
      return this.prisma.cobrancaCliente.update({
        where: { id: orfa.id },
        data: { asaasPaymentId: p.id, linkFatura: p.invoiceUrl ?? null },
      });
    }
    const ocupada = await this.prisma.cobrancaCliente.findUnique({ where: { tituloAtivoId: titulo.id } });
    return this.prisma.cobrancaCliente.create({
      data: {
        tituloReceberId: titulo.id,
        // Se já há outra viva pro título, esta entra como histórico — a baixa
        // acontece do mesmo jeito.
        tituloAtivoId: ocupada ? null : titulo.id,
        ambiente: conexao?.ambiente ?? "PRODUCAO",
        asaasPaymentId: p.id,
        valor: reaisDoAsaas(p.value) ?? "0",
        vencimento: p.dueDate ? diaUtc(p.dueDate) : inicioDoDiaData(),
        linkFatura: p.invoiceUrl ?? null,
      },
    });
  }

  /**
   * Aplica um evento a uma cobrança, numa transação com a linha travada.
   *
   * `FOR UPDATE` serializa eventos simultâneos do mesmo pagamento (o Asaas
   * manda CONFIRMED e RECEIVED com segundos de diferença): o segundo espera o
   * primeiro terminar e já encontra PAGA, em vez de os dois verem PENDENTE e
   * tentarem baixar. SQL cru filtra `contaId` à mão — a trava não alcança.
   */
  async aplicar(cobrancaId: string, tipo: string, p: PagamentoAsaasCliente): Promise<string> {
    const contaId = (await this.prisma.cobrancaCliente.findUnique({ where: { id: cobrancaId }, select: { contaId: true } }))
      ?.contaId;
    if (!contaId) return "ignorado: cobrança sumiu";

    let decisao: DecisaoEvento = { acao: "nada" };
    let antes: CobrancaCliente | null = null;
    let tituloNome: { empresa: string; fatura: number | null; parcela: number; tituloId: string } | null = null;

    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "cobrancas_cliente" WHERE id = ${cobrancaId} AND "contaId" = ${contaId} FOR UPDATE`;
      const cob = await tx.cobrancaCliente.findUniqueOrThrow({ where: { id: cobrancaId } });
      antes = cob;
      decisao = decidirEvento(cob.status, tipo);

      const titulo = await tx.tituloReceber.findUniqueOrThrow({
        where: { id: cob.tituloReceberId },
        select: { id: true, valor: true, status: true, parcela: true, empresa: { select: { nome: true } }, fatura: { select: { numero: true } } },
      });
      tituloNome = { empresa: titulo.empresa.nome, fatura: titulo.fatura?.numero ?? null, parcela: titulo.parcela, tituloId: titulo.id };

      const reapurar = async () => {
        const baixas = await tx.baixaTitulo.findMany({ where: { tituloReceberId: titulo.id }, select: { valor: true } });
        const r = apurarTitulo(titulo.valor, baixas, titulo.status);
        await tx.tituloReceber.update({ where: { id: titulo.id }, data: { valorPago: r.valorPago, status: r.status } });
      };

      switch (decisao.acao) {
        case "baixar": {
          const valor = reaisDoAsaas(p.value) ?? cob.valor.toString();
          const data = p.paymentDate ?? p.clientPaymentDate ?? null;
          const meio = meioDoBillingType(p.billingType);
          const liquido = reaisDoAsaas(p.netValue);
          const ja = await tx.baixaTitulo.findUnique({ where: { cobrancaClienteId: cob.id } });
          if (!ja) {
            await tx.baixaTitulo.create({
              data: {
                tituloReceberId: titulo.id,
                cobrancaClienteId: cob.id,
                usuarioId: null,
                data: data ? diaUtc(data) : inicioDoDiaData(),
                valor,
                meio,
                observacao:
                  `Recebido pelo Asaas (cobrança ${p.id})` +
                  (liquido && liquido !== valor ? ` — líquido ${brl(liquido)} depois da tarifa` : ""),
              },
            });
            await reapurar();
          }
          await tx.cobrancaCliente.update({
            where: { id: cob.id },
            data: {
              status: "PAGA",
              pagoEm: data ? diaUtc(data) : inicioDoDiaData(),
              valorRecebido: valor,
              meio,
            },
          });
          break;
        }
        case "estornar": {
          await tx.baixaTitulo.deleteMany({ where: { cobrancaClienteId: cob.id } });
          await reapurar();
          await tx.cobrancaCliente.update({
            where: { id: cob.id },
            data: { status: "ESTORNADA", tituloAtivoId: null },
          });
          break;
        }
        case "status": {
          const novo = decisao.novo!;
          let tituloAtivoId: string | null | undefined;
          if (novo === "CANCELADA" || novo === "ESTORNADA") tituloAtivoId = null;
          if (novo === "PENDENTE") {
            // Restaurada no Asaas: só volta a ser A viva do título se a vaga estiver livre.
            const ocupada = await tx.cobrancaCliente.findUnique({ where: { tituloAtivoId: titulo.id } });
            if (ocupada && ocupada.id !== cob.id) {
              decisao = { acao: "nada", motivo: "restaurada, mas o título já tem outra cobrança viva" };
              break;
            }
            tituloAtivoId = titulo.id;
          }
          await tx.cobrancaCliente.update({
            where: { id: cob.id },
            data: { status: novo, ...(tituloAtivoId !== undefined ? { tituloAtivoId } : {}) },
          });
          break;
        }
        case "atualizar": {
          await tx.cobrancaCliente.update({
            where: { id: cob.id },
            data: {
              ...(reaisDoAsaas(p.value) ? { valor: reaisDoAsaas(p.value)! } : {}),
              ...(p.dueDate ? { vencimento: diaUtc(p.dueDate) } : {}),
              ...(p.invoiceUrl ? { linkFatura: p.invoiceUrl } : {}),
            },
          });
          break;
        }
        case "nada":
          break;
      }
    });

    const d = decisao as DecisaoEvento;
    const cobAntes = antes as CobrancaCliente | null;
    const t = tituloNome as { empresa: string; fatura: number | null; parcela: number; tituloId: string } | null;

    if (d.acao !== "nada" && d.acao !== "atualizar" && cobAntes && t) {
      // usuarioId null: quem decidiu foi o banco, pelo gateway.
      await this.auditoria
        .log({
          usuarioId: null,
          entidade: "TituloReceber",
          entidadeId: t.tituloId,
          acao: AcaoAuditoria.UPDATE,
          campo: "cobranca-asaas",
          valorAntes: { status: cobAntes.status },
          valorDepois: { status: d.novo, evento: tipo, valor: p.value ?? null },
          motivo: `Asaas: ${tipo}`,
          metadata: { asaasPaymentId: p.id },
        })
        .catch((e) => this.log.warn(`auditoria: ${(e as Error).message}`));
    }

    if (d.avisar && t) await this.avisar(d.avisar, t, p);

    return d.acao === "nada" ? `ignorado: ${d.motivo ?? "sem efeito"}` : `aplicado: ${d.acao}${d.novo ? ` → ${d.novo}` : ""}`;
  }

  private async avisar(
    tipo: NonNullable<DecisaoEvento["avisar"]>,
    t: { empresa: string; fatura: number | null; parcela: number; tituloId: string },
    p: PagamentoAsaasCliente,
  ) {
    const qual = t.fatura ? `fatura ${t.fatura}${t.parcela > 1 ? `, parcela ${t.parcela}` : ""}` : `parcela ${t.parcela}`;
    const valor = p.value != null ? brl(p.value) : "";
    const textos: Record<typeof tipo, { titulo: string; corpo: string }> = {
      paga: { titulo: `${t.empresa} pagou ${valor}`, corpo: `A ${qual} foi paga pelo Asaas e a baixa já foi lançada.` },
      vencida: { titulo: `${t.empresa}: boleto vencido`, corpo: `A ${qual} venceu sem pagamento.` },
      estornada: {
        titulo: `${t.empresa}: pagamento estornado`,
        corpo: `O pagamento da ${qual} foi estornado no Asaas. A baixa foi desfeita e o título voltou a ficar em aberto.`,
      },
      contestacao: {
        titulo: `${t.empresa}: pagamento contestado`,
        corpo: `O cartão contestou o pagamento da ${qual}. A baixa continua lançada até o Asaas decidir — acompanhe por lá.`,
      },
      "estorno-parcial": {
        titulo: `${t.empresa}: estorno parcial`,
        corpo: `Parte do pagamento da ${qual} foi devolvida no Asaas. Ajuste a baixa à mão se for o caso.`,
      },
    };
    try {
      await this.inbox.disparar({
        tipo: "cobranca-cliente",
        ...textos[tipo],
        dados: { tituloId: t.tituloId, evento: tipo },
        permissao: "financeiro.ver",
      });
    } catch (e) {
      this.log.warn(`aviso no sininho falhou: ${(e as Error).message}`);
    }
  }
}
