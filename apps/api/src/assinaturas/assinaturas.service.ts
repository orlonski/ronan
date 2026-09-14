import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { AcaoAuditoria, type Assinatura, type Prisma } from "@prisma/client";
import {
  custoDeReceber,
  type AtualizarAssinaturaInput,
  type BaixaManualInput,
  type CriarAssinaturaInput,
  type FormaCobranca,
} from "@ronan/shared-types";
import { AuditoriaService } from "../auditoria/auditoria.service";
import { PrecosService } from "../admin/precos/precos.service";
import { comConta, comoSistema } from "../common/conta/conta-context";
import {
  competenciaDe,
  diasDeAtraso,
  hojeData,
  proximaCompetencia,
  vencimentoDe,
} from "../common/assinatura-cobranca";
import { PrismaService } from "../prisma/prisma.service";
import { AsaasProvedor } from "./asaas.provedor";
import { AvisoCobrancaService } from "./aviso-cobranca.service";
import { ErroGateway } from "./gateway.types";

/** Status em que a assinatura ainda ocupa a vaga da conta. */
const STATUS_VIVOS = ["RASCUNHO", "AGUARDANDO", "ATIVA", "INADIMPLENTE"] as const;

/**
 * A gestão das assinaturas, do lado da plataforma.
 *
 * TUDO aqui roda em `comoSistema`, e isso é uma decisão, não um descuido: quem
 * opera esta tela é a Movatruck olhando para as empresas clientes — a conta no
 * contexto é a da própria plataforma, e deixar a trava filtrar por ela faria a
 * lista vir vazia. As duas tabelas continuam escopadas justamente pra que a
 * tela do CLIENTE, quando existir, saia filtrada sozinha.
 */
@Injectable()
export class AssinaturasService {
  private readonly log = new Logger(AssinaturasService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: AsaasProvedor,
    private readonly precos: PrecosService,
    private readonly auditoria: AuditoriaService,
    private readonly aviso: AvisoCobrancaService,
  ) {}

  /**
   * Todas as assinaturas, com o que a tela precisa pra decidir o que fazer
   * hoje: quanto está em aberto e há quantos dias.
   */
  async listar() {
    const assinaturas = await comoSistema(() =>
      this.prisma.assinatura.findMany({
        where: { status: { not: "CANCELADA" } },
        include: {
          conta: { select: { id: true, nome: true, slug: true, ativa: true, somenteLeitura: true } },
          cobrancas: {
            // Em aberto OU contestada: as duas coisas precisam ser vistas. Uma
            // contestação não é dívida do cliente, é dinheiro que saiu da conta
            // e está em disputa — e some da tela se a gente olhar só o que está
            // "em aberto".
            where: {
              OR: [{ status: { in: ["PENDENTE", "VENCIDA"] } }, { contestadaEm: { not: null } }],
            },
            orderBy: { vencimento: "asc" },
          },
        },
        orderBy: { criadoEm: "asc" },
      }),
    );

    const hoje = new Date();
    return assinaturas.map((a) => {
      const contestadas = a.cobrancas.filter((c) => c.contestadaEm !== null);
      const emAberto = a.cobrancas.filter(
        (c) => c.contestadaEm === null && (c.status === "PENDENTE" || c.status === "VENCIDA"),
      );
      const maisAntiga = emAberto[0];
      return {
        ...this.paraTela(a),
        conta: a.conta,
        emAberto: {
          quantidade: emAberto.length,
          totalCentavos: emAberto.reduce((s, c) => s + c.valorCentavos, 0),
          /** Dias de atraso da mais antiga. Negativo = ainda não venceu. */
          diasDeAtraso: maisAntiga ? diasDeAtraso(maisAntiga.vencimento, hoje) : null,
        },
        /**
         * Cobranças que o cliente contestou no cartão.
         *
         * Separadas do "em aberto" de propósito: não são dívida a cobrar, são
         * disputa a resolver. Misturar as duas faria a tela pedir cobrança
         * automática de quem contestou — que é exatamente o que não se faz.
         */
        contestadas: {
          quantidade: contestadas.length,
          totalCentavos: contestadas.reduce((s, c) => s + c.valorCentavos, 0),
        },
      };
    });
  }

  /** Uma assinatura com o histórico de cobranças. */
  async detalhar(id: string) {
    const a = await comoSistema(() =>
      this.prisma.assinatura.findFirst({
        where: { id },
        include: {
          conta: { select: { id: true, nome: true, slug: true } },
          cobrancas: { orderBy: { competencia: "desc" } },
        },
      }),
    );
    if (!a) throw new NotFoundException("Assinatura não encontrada.");
    return { ...this.paraTela(a), conta: a.conta, cobrancas: a.cobrancas };
  }

  /**
   * Quanto cobrar desta empresa, segundo a tabela de preço e o tamanho da frota.
   *
   * É sugestão, nunca imposição: quem cria a assinatura pode mudar o valor.
   * Desconto de fundador, condição de migração e preço congelado por 24 meses
   * são conversas que acontecem — e um número que não aceita ser mudado vira
   * um número contornado por fora do sistema.
   */
  async sugerir(contaId: string) {
    const conta = await comoSistema(() =>
      this.prisma.conta.findFirst({
        where: { id: contaId },
        select: { id: true, nome: true, cnpj: true, razaoSocial: true },
      }),
    );
    if (!conta) throw new NotFoundException("Empresa não encontrada.");

    // A contagem roda DENTRO da conta: é dado dela, e a trava é quem garante
    // que a frota contada é a certa.
    const veiculos = await comConta(contaId, () =>
      this.prisma.veiculo.count({ where: { ativo: true } }),
    );
    const faixa = await this.precos.precoPara(veiculos);

    return {
      conta,
      veiculos,
      faixa,
      valorSugeridoCentavos: faixa?.valorCentavos ?? null,
      /**
       * O que cada forma custaria de taxa. É o número que faz o Pix Automático
       * ser oferecido primeiro: em cima de R$ 1.890, o cartão come R$ 57 por
       * mês contra R$ 1,99 do Pix.
       */
      custoPorForma: faixa
        ? (["PIX_AUTOMATICO", "PIX", "BOLETO", "CARTAO"] as FormaCobranca[]).map((forma) => ({
            forma,
            taxaCentavos: custoDeReceber(forma, faixa.valorCentavos),
          }))
        : [],
    };
  }

  /**
   * Cria a assinatura e a espelha no gateway.
   *
   * A ordem importa: grava o RASCUNHO primeiro, chama o gateway depois. Ao
   * contrário, uma falha nossa depois de criar lá deixaria uma assinatura
   * cobrando de verdade sem linha nenhuma deste lado — e ninguém saberia que
   * ela existe até o cliente ligar perguntando do débito.
   */
  async criar(dados: CriarAssinaturaInput, usuarioId: string) {
    const conta = await comoSistema(() =>
      this.prisma.conta.findFirst({
        where: { id: dados.contaId },
        select: { id: true, nome: true },
      }),
    );
    if (!conta) throw new NotFoundException("Empresa não encontrada.");

    const viva = await comoSistema(() =>
      this.prisma.assinatura.findFirst({
        where: { contaId: dados.contaId, status: { in: [...STATUS_VIVOS] } },
      }),
    );
    if (viva) {
      throw new ConflictException(
        `${conta.nome} já tem uma assinatura em andamento. Cancele a atual antes de criar outra.`,
      );
    }

    const primeiroVencimento = dados.primeiroVencimento
      ? new Date(`${dados.primeiroVencimento}T00:00:00.000Z`)
      : vencimentoDe(proximaCompetencia(competenciaDe()), dados.diaVencimento);

    if (primeiroVencimento.getTime() < hojeData().getTime()) {
      throw new BadRequestException("O primeiro vencimento não pode ser no passado.");
    }

    // Data de início escolhida manda no dia do mês.
    //
    // Sem isto a tela mentia: "vence dia 10" numa assinatura que começa em 18.
    // E não é só o texto — a recorrência do gateway anda a partir da data de
    // início, então quem vence 18/09 vence 18/10, e o `diaVencimento` guardado
    // é o que a régua usa pra falar com o cliente. Dois números discordando
    // sobre quando a conta vence é o tipo de coisa que vira discussão.
    //
    // O dia 29, 30 ou 31 não vira `diaVencimento` (a coluna para em 28, porque
    // fevereiro não tem dia 30): nesses casos o combinado do mês segue o que
    // foi digitado no campo de dia.
    const diaDoInicio = primeiroVencimento.getUTCDate();
    const diaVencimento =
      dados.primeiroVencimento && diaDoInicio <= 28 ? diaDoInicio : dados.diaVencimento;

    const assinatura = await comoSistema(() =>
      this.prisma.assinatura.create({
        data: {
          contaId: dados.contaId,
          status: "RASCUNHO",
          forma: dados.forma,
          ciclo: dados.ciclo,
          valorCentavos: dados.valorCentavos,
          diaVencimento,
          nomeResponsavel: dados.nomeResponsavel,
          emailCobranca: dados.emailCobranca,
          telefoneCobranca: dados.telefoneCobranca,
          documento: dados.documento,
          proximoVencimento: primeiroVencimento,
          observacao: dados.observacao ?? null,
          criadoPorId: usuarioId,
        },
      }),
    );

    return this.espelharNoGateway(assinatura.id, dados.avisarCliente !== false);
  }

  /**
   * Leva pro gateway uma assinatura que ainda é rascunho.
   *
   * Separado do `criar` porque é o ponto que falha: gateway fora do ar, CNPJ
   * recusado, chave Pix faltando. Com o rascunho já gravado, tentar de novo é
   * um clique — e não recomeçar o cadastro inteiro.
   */
  async espelharNoGateway(id: string, avisarCliente = true) {
    const assinatura = await comoSistema(() =>
      this.prisma.assinatura.findFirst({
        where: { id },
        include: { conta: { select: { nome: true } } },
      }),
    );
    if (!assinatura) throw new NotFoundException("Assinatura não encontrada.");
    if (assinatura.status !== "RASCUNHO") {
      throw new ConflictException("Esta assinatura já está no gateway.");
    }
    if (!this.gateway.configurado()) {
      throw new BadRequestException(
        "O gateway de pagamento não está configurado no servidor (falta ASAAS_API_KEY).",
      );
    }

    try {
      const clienteId =
        assinatura.gatewayClienteId ??
        (await this.gateway.garantirCliente({
          nome: assinatura.nomeResponsavel,
          documento: assinatura.documento,
          email: assinatura.emailCobranca,
          telefone: assinatura.telefoneCobranca,
          referenciaExterna: assinatura.contaId,
        }));

      const criada = await this.gateway.criarAssinatura({
        clienteId,
        forma: assinatura.forma,
        ciclo: assinatura.ciclo === "ANUAL" ? "ANUAL" : "MENSAL",
        valorCentavos: assinatura.valorCentavos,
        primeiroVencimento: paraYmd(assinatura.proximoVencimento ?? hojeData()),
        descricao: `Movatruck — ${assinatura.conta.nome}`,
        referenciaExterna: assinatura.id,
      });

      const atualizada = await comoSistema(() =>
        this.prisma.assinatura.update({
          where: { id: assinatura.id },
          data: {
            gatewayClienteId: clienteId,
            // No Pix Automático o id é o da autorização; nas outras formas é o
            // da assinatura. Guardados em campos diferentes porque são objetos
            // diferentes na API — um não serve de chave pro outro.
            gatewayAssinaturaId: assinatura.forma === "PIX_AUTOMATICO" ? null : criada.id,
            gatewayAutorizacaoId: assinatura.forma === "PIX_AUTOMATICO" ? criada.id : null,
            qrCodePayload: criada.qrCodePayload ?? null,
            qrCodeExpiraEm: criada.qrCodeExpiraEm ?? null,
            status: criada.ativaImediatamente ? "ATIVA" : "AGUARDANDO",
            inicioEm: criada.ativaImediatamente ? new Date() : null,
          },
        }),
      );

      this.log.log(
        `Assinatura ${assinatura.id} (${assinatura.conta.nome}) criada no gateway como ${criada.id}.`,
      );

      // O cliente é avisado AGORA, não 3 dias antes do vencimento.
      //
      // Sem isto, entre "fechei o contrato" e o primeiro aviso da régua havia
      // um silêncio em que ele não sabia como pagar nem que precisava fazer
      // algo — e é nesse silêncio que uma assinatura fica parada para sempre
      // esperando uma autorização que ninguém pediu.
      //
      // O envio nunca lança: WhatsApp fora do ar não pode desfazer uma
      // assinatura que já existe no gateway. Se falhar, sobra o botão "Mandar
      // no WhatsApp" na tela, e o log diz o motivo.
      if (avisarCliente) {
        const aviso = await this.aviso.avisarAgora(assinatura.id);
        if (!aviso.enviado) {
          this.log.warn(
            `Assinatura ${assinatura.id} criada, mas o aviso não saiu: ${aviso.motivo}`,
          );
        }
      }

      return this.paraTela(atualizada);
    } catch (erro) {
      if (erro instanceof ErroGateway) {
        // A mensagem do gateway é escrita pra humano ("CPF/CNPJ inválido") e é
        // ela que resolve o problema de quem está na tela — não "erro 400".
        throw new BadRequestException(`O gateway recusou: ${erro.message}`);
      }
      throw erro;
    }
  }

  async atualizar(id: string, dados: AtualizarAssinaturaInput) {
    const assinatura = await this.buscarOuFalhar(id);
    if (assinatura.status === "CANCELADA") {
      throw new ConflictException("Assinatura cancelada não se edita.");
    }

    // O valor e o dia de vencimento valem da PRÓXIMA cobrança em diante. O que
    // já foi gerado não muda: uma cobrança emitida é um documento, e reescrever
    // o valor dela depois de mandada é o caminho curto pra uma discussão que
    // ninguém ganha.
    const atualizada = await comoSistema(() =>
      this.prisma.assinatura.update({
        where: { id },
        data: {
          valorCentavos: dados.valorCentavos,
          diaVencimento: dados.diaVencimento,
          nomeResponsavel: dados.nomeResponsavel,
          emailCobranca: dados.emailCobranca,
          telefoneCobranca: dados.telefoneCobranca,
          observacao: dados.observacao,
        },
      }),
    );
    return this.paraTela(atualizada);
  }

  /**
   * Cancela a assinatura — e SÓ a assinatura.
   *
   * Não encosta em `Conta.ativa` nem em `somenteLeitura`: cortar o acesso de
   * uma empresa é decisão humana e separada, tomada na tela de Empresas
   * (decisão do dono em 14/09/2026). Cancelar aqui significa "para de cobrar",
   * nunca "tira do ar".
   */
  async cancelar(id: string, motivo: string, usuarioId: string) {
    const assinatura = await this.buscarOuFalhar(id);

    // Antes do retorno curto de propósito: "já cancelada aqui" não é prova de que o
    // gateway também parou. Quando o cliente cancela a autorização no app do
    // banco, o webhook marca CANCELADA do nosso lado e a assinatura do gateway
    // segue viva, com a cobrança do mês seguinte já aberta no nome dele.
    await this.encerrarNoGateway(assinatura);

    if (assinatura.status === "CANCELADA") return this.paraTela(assinatura);

    const cancelada = await comoSistema(async () => {
      // As cobranças ainda em aberto morrem junto: deixá-las vivas faria a
      // régua continuar cobrando uma assinatura que não existe mais.
      await this.prisma.cobrancaAssinatura.updateMany({
        where: { assinaturaId: id, status: { in: ["PENDENTE", "VENCIDA"] } },
        data: { status: "CANCELADA" },
      });
      return this.prisma.assinatura.update({
        where: { id },
        data: {
          status: "CANCELADA",
          canceladaEm: new Date(),
          canceladaPorId: usuarioId,
          motivoCancelamento: motivo,
        },
      });
    });

    await comConta(assinatura.contaId, () =>
      this.auditoria.log({
        usuarioId,
        entidade: "Assinatura",
        entidadeId: id,
        acao: AcaoAuditoria.CANCELAR_ASSINATURA,
        motivo,
        valorAntes: { status: assinatura.status, valorCentavos: assinatura.valorCentavos },
        valorDepois: { status: "CANCELADA" },
      }),
    );

    this.log.log(`Assinatura ${id} cancelada: ${motivo}`);
    return this.paraTela(cancelada);
  }

  /**
   * Apaga do gateway TUDO que ainda cobraria esta assinatura.
   *
   * Três coisas, porque matar uma não mata as outras — e foi assim que duas
   * assinaturas canceladas em 14/09/2026 amanheceram com cobrança aberta pra
   * 10/10 no nome do cliente:
   *
   * 1. **A autorização do Pix Automático**, que é o consentimento no banco.
   * 2. **A assinatura do gateway.** No Pix Automático ela existe mesmo sem a
   *    gente ter pedido: `paymentCreationMode: SUBSCRIPTION` faz o Asaas criar
   *    uma por baixo, e ela sobrevive à morte da autorização, continuando a
   *    marcar "próxima cobrança" todo mês.
   * 3. **As cobranças que já nasceram.** Apagar a assinatura nem sempre leva
   *    junto o que ela já gerou. Esta é a rede que pega o caso em que a gente
   *    nunca ficou sabendo o id da assinatura lá.
   *
   * Idempotente de ponta a ponta: cada passo trata "não existe mais" como
   * sucesso, porque o objetivo — não cobrar de novo — já está cumprido.
   */
  async encerrarNoGateway(assinatura: Assinatura) {
    if (!this.gateway.configurado()) return;

    if (assinatura.gatewayAutorizacaoId) {
      await this.gateway.cancelarAssinatura(assinatura.gatewayAutorizacaoId, assinatura.forma);
    }
    if (assinatura.gatewayAssinaturaId) {
      // Sempre pelo caminho de assinatura comum: o que se apaga aqui é o objeto
      // `subscription`, mesmo quando a forma é Pix Automático.
      await this.gateway.cancelarAssinatura(assinatura.gatewayAssinaturaId, "PIX");
    }

    // Nunca uma cobrança já paga: apagar o que entrou apagaria a receita, e o
    // extrato do gateway deixaria de bater com o nosso.
    const abertas = await comoSistema(() =>
      this.prisma.cobrancaAssinatura.findMany({
        where: {
          assinaturaId: assinatura.id,
          gatewayCobrancaId: { not: null },
          status: { notIn: ["CONFIRMADA", "RECEBIDA"] },
        },
        select: { id: true, gatewayCobrancaId: true },
      }),
    );

    for (const cobranca of abertas) {
      await this.gateway.cancelarCobranca(cobranca.gatewayCobrancaId!);
    }
  }

  /**
   * Dá uma mensalidade como paga sem o gateway ter confirmado.
   *
   * Existe porque o primeiro mês de todo cliente migrado entra assim: ele pagou
   * no Pix da conta, na mão, antes da assinatura existir. Sem isto, a cobrança
   * ficaria vencida pra sempre e a régua cobraria alguém que já pagou.
   *
   * É a única forma de uma cobrança virar paga sem prova externa — por isso
   * exige motivo escrito e guarda quem deu a baixa.
   */
  async baixaManual(cobrancaId: string, dados: BaixaManualInput, usuarioId: string) {
    const cobranca = await comoSistema(() =>
      this.prisma.cobrancaAssinatura.findFirst({ where: { id: cobrancaId } }),
    );
    if (!cobranca) throw new NotFoundException("Cobrança não encontrada.");
    if (cobranca.status === "CONFIRMADA" || cobranca.status === "RECEBIDA") {
      throw new ConflictException("Esta cobrança já consta como paga.");
    }

    const paga = await comoSistema(() =>
      this.prisma.cobrancaAssinatura.update({
        where: { id: cobrancaId },
        data: {
          status: "RECEBIDA",
          pagoEm: new Date(`${dados.pagoEm}T12:00:00.000Z`),
          valorPagoCentavos: dados.valorCentavos ?? cobranca.valorCentavos,
          baixadaPorId: usuarioId,
          motivoBaixa: dados.motivo,
        },
      }),
    );

    await this.reavaliarInadimplencia(cobranca.assinaturaId);

    await comConta(cobranca.contaId, () =>
      this.auditoria.log({
        usuarioId,
        entidade: "CobrancaAssinatura",
        entidadeId: cobrancaId,
        acao: AcaoAuditoria.BAIXA_MANUAL_COBRANCA,
        motivo: dados.motivo,
        valorAntes: { status: cobranca.status },
        valorDepois: { status: "RECEBIDA", pagoEm: dados.pagoEm },
      }),
    );

    return paga;
  }

  /**
   * A assinatura ainda está inadimplente?
   *
   * Chamado toda vez que uma cobrança é paga. Sem isso, uma empresa que
   * regularizou tudo continuaria marcada como em atraso até alguém reparar —
   * e apareceria vermelha numa tela que a plataforma usa pra decidir quem
   * cobrar.
   */
  async reavaliarInadimplencia(assinaturaId: string): Promise<void> {
    await comoSistema(async () => {
      const assinatura = await this.prisma.assinatura.findFirst({
        where: { id: assinaturaId },
        select: { id: true, status: true },
      });
      if (!assinatura || assinatura.status === "CANCELADA") return;

      const vencidas = await this.prisma.cobrancaAssinatura.count({
        where: { assinaturaId, status: "VENCIDA" },
      });

      const novo = vencidas > 0 ? "INADIMPLENTE" : "ATIVA";
      // AGUARDANDO não vira ATIVA por aqui: quem autoriza é o cliente, e é o
      // webhook do primeiro pagamento que conta isso.
      if (assinatura.status === "AGUARDANDO" && novo === "ATIVA") return;
      if (assinatura.status === novo) return;

      await this.prisma.assinatura.update({ where: { id: assinaturaId }, data: { status: novo } });
    });
  }

  private async buscarOuFalhar(id: string): Promise<Assinatura> {
    const a = await comoSistema(() => this.prisma.assinatura.findFirst({ where: { id } }));
    if (!a) throw new NotFoundException("Assinatura não encontrada.");
    return a;
  }

  /**
   * O que sai pra tela.
   *
   * Montado campo a campo, nunca por spread do registro: é a fronteira onde o
   * documento de quem paga e os ids do gateway não precisam aparecer. Whitelist
   * na fronteira, porque blacklist vaza o campo que alguém adicionar amanhã.
   */
  private paraTela(a: Assinatura) {
    return {
      id: a.id,
      contaId: a.contaId,
      status: a.status,
      forma: a.forma,
      ciclo: a.ciclo,
      valorCentavos: a.valorCentavos,
      diaVencimento: a.diaVencimento,
      nomeResponsavel: a.nomeResponsavel,
      emailCobranca: a.emailCobranca,
      telefoneCobranca: a.telefoneCobranca,
      // Só os últimos dígitos do documento: a tela precisa reconhecer o
      // cadastro, não repetir o CNPJ inteiro em toda listagem.
      documentoFinal: a.documento.slice(-4),
      cartaoBandeira: a.cartaoBandeira,
      cartaoUltimos4: a.cartaoUltimos4,
      qrCodePayload: a.qrCodePayload,
      qrCodeExpiraEm: a.qrCodeExpiraEm,
      inicioEm: a.inicioEm,
      proximoVencimento: a.proximoVencimento,
      canceladaEm: a.canceladaEm,
      motivoCancelamento: a.motivoCancelamento,
      observacao: a.observacao,
      taxaPorCobrancaCentavos: custoDeReceber(a.forma, a.valorCentavos),
      criadoEm: a.criadoEm,
    };
  }
}

/** Date → "AAAA-MM-DD", que é o formato de data do gateway. */
export function paraYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export type AssinaturaComConta = Prisma.AssinaturaGetPayload<{ include: { conta: true } }>;
