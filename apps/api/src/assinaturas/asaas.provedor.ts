import { Injectable, Logger } from "@nestjs/common";
import type { CicloAssinatura, FormaCobranca } from "@ronan/shared-types";
import { AsaasConfig } from "./asaas.config";
import {
  ErroGateway,
  type AssinaturaCriada,
  type ClienteGateway,
  type CobrancaGateway,
  type GatewayPagamento,
  type NovaAssinaturaGateway,
} from "./gateway.types";

/**
 * O Asaas falando a nossa língua.
 *
 * Duas traduções moram aqui e em nenhum outro lugar:
 *
 * 1. **Centavos ↔ reais.** O sistema inteiro guarda centavos (inteiro, soma sem
 *    erro de ponto flutuante); o Asaas fala `189.9`. A conversão acontece na
 *    borda, exatamente como acontece com o dinheiro das viagens.
 * 2. **Forma de cobrança ↔ o caminho da API.** `PIX_AUTOMATICO` não é um
 *    `billingType`: é outro endpoint, outro objeto e outro ciclo de vida. Quem
 *    chama não precisa saber disso.
 */
@Injectable()
export class AsaasProvedor implements GatewayPagamento {
  readonly nome = "asaas";
  private readonly log = new Logger(AsaasProvedor.name);

  /**
   * Como o provedor fala HTTP. Campo, e não parâmetro do construtor, porque o
   * Nest tentaria INJETAR um parâmetro — e não existe provider pra `fetch`.
   * Teste troca isto por um dublê.
   */
  buscar: typeof fetch = fetch;

  constructor(private readonly config: AsaasConfig) {}

  configurado(): boolean {
    return this.config.habilitado;
  }

  async garantirCliente(dados: ClienteGateway): Promise<string> {
    // Procura pelo documento ANTES de criar. O Asaas aceita dois clientes com o
    // mesmo CNPJ sem reclamar, e aí o histórico da empresa se parte em dois.
    const achados = await this.get<{ data?: { id: string }[] }>(
      `/customers?cpfCnpj=${encodeURIComponent(dados.documento)}&limit=1`,
    );
    const existente = achados.data?.[0]?.id;
    if (existente) {
      // Mantém contato e referência em dia: e-mail do financeiro muda, e a
      // referência externa é o que liga o painel do Asaas à nossa conta.
      await this.post(`/customers/${existente}`, this.corpoCliente(dados), "POST");
      return existente;
    }

    const criado = await this.post<{ id: string }>("/customers", this.corpoCliente(dados));
    return criado.id;
  }

  private corpoCliente(dados: ClienteGateway) {
    return {
      name: dados.nome,
      cpfCnpj: dados.documento,
      email: dados.email,
      mobilePhone: dados.telefone,
      externalReference: dados.referenciaExterna,
      // As notificações do Asaas custam R$ 0,55 por mensagem e diriam a mesma
      // coisa que a nossa régua já diz, pelo nosso WhatsApp e com a nossa voz.
      // Duas cobranças pela mesma dívida confundem quem paga.
      notificationDisabled: true,
    };
  }

  async criarAssinatura(dados: NovaAssinaturaGateway): Promise<AssinaturaCriada> {
    if (dados.forma === "PIX_AUTOMATICO") return this.criarAutorizacaoPix(dados);
    return this.criarAssinaturaComum(dados);
  }

  /**
   * Assinatura comum: o Asaas gera as cobranças sozinho, mês a mês, e avisa por
   * webhook. Nosso cron não precisa criar nada.
   *
   * No cartão, a primeira cobrança só passa quando o cliente informar o cartão
   * na página de pagamento — por isso `ativaImediatamente` é false: a
   * assinatura existe, mas ninguém autorizou nada ainda.
   */
  private async criarAssinaturaComum(dados: NovaAssinaturaGateway): Promise<AssinaturaCriada> {
    const criada = await this.post<{ id: string }>("/subscriptions", {
      customer: dados.clienteId,
      billingType: this.billingType(dados.forma),
      value: centavosParaReais(dados.valorCentavos),
      nextDueDate: dados.primeiroVencimento,
      cycle: this.cycle(dados.ciclo),
      description: dados.descricao,
      externalReference: dados.referenciaExterna,
    });

    return { id: criada.id, ativaImediatamente: dados.forma !== "CARTAO" };
  }

  /**
   * Pix Automático: uma AUTORIZAÇÃO, não uma assinatura.
   *
   * O cliente paga um QR Code uma vez e, ao pagar, autoriza no app do banco que
   * as próximas caiam sozinhas. Só depois desse primeiro pagamento a
   * autorização vira `ACTIVE` — antes disso não há o que cobrar.
   *
   * `paymentCreationMode: SUBSCRIPTION` faz o Asaas gerar as cobranças
   * seguintes. O modo MANUAL nos obrigaria a criar cada uma entre 2 e 10 dias
   * úteis antes do vencimento — um cron a mais, com uma janela apertada, pra
   * fazer o que o gateway já faz.
   */
  private async criarAutorizacaoPix(dados: NovaAssinaturaGateway): Promise<AssinaturaCriada> {
    if (!this.config.chavePix) {
      throw new ErroGateway(
        null,
        false,
        "Falta a chave Pix da Movatruck (ASAAS_CHAVE_PIX) para receber o Pix Automático.",
      );
    }

    // ATENÇÃO ao formato da RESPOSTA, que não espelha o da requisição: o
    // copia-e-cola vem em `payload`, na RAIZ, e o objeto `immediateQrCode`
    // carrega só a conciliação e o vencimento. Mandar o QR dentro de
    // `immediateQrCode` e recebê-lo fora dele é assimétrico o bastante pra
    // enganar — e enganou: a primeira autorização de produção nasceu sem
    // copia-e-cola nenhum porque este código lia `immediateQrCode.payload`.
    const criada = await this.post<{
      id: string;
      payload?: string;
      encodedImage?: string;
      immediateQrCode?: { payload?: string; expirationDate?: string };
    }>("/pix/automatic/authorizations", {
      customerId: dados.clienteId,
      // O gateway limita a 35 caracteres nos dois campos, e corta em silêncio
      // o que passar — cortar aqui é o que evita descobrir isso no extrato.
      contractId: dados.referenciaExterna.slice(0, 35),
      description: dados.descricao.slice(0, 35),
      frequency: dados.ciclo === "ANUAL" ? "ANNUALLY" : "MONTHLY",
      startDate: dados.primeiroVencimento,
      value: centavosParaReais(dados.valorCentavos),
      paymentCreationMode: "SUBSCRIPTION",
      // Três tentativas em sete dias: saldo insuficiente no dia do vencimento é
      // o motivo mais comum de falha, e costuma resolver sozinho no dia
      // seguinte. Sem retentativa, um dia sem saldo vira inadimplência.
      retryPolicy: "ALLOW_THREE_IN_SEVEN_DAYS",
      immediateQrCode: {
        // 3 dias pra pagar o primeiro. Menos que isso e um QR mandado numa
        // sexta vence antes de alguém abrir na segunda.
        expirationSeconds: 3 * 24 * 60 * 60,
        originalValue: centavosParaReais(dados.valorCentavos),
        pixKey: this.config.chavePix,
        description: dados.descricao.slice(0, 35),
      },
    });

    const expira = criada.immediateQrCode?.expirationDate;
    return {
      id: criada.id,
      // A raiz primeiro, que é onde o gateway de fato responde; o aninhado
      // fica como rede caso eles alinhem os dois formatos um dia.
      qrCodePayload: criada.payload ?? criada.immediateQrCode?.payload,
      qrCodeExpiraEm: expira ? new Date(expira) : undefined,
      // Só vira ativa quando o primeiro Pix for pago.
      ativaImediatamente: false,
    };
  }

  async cancelarAssinatura(id: string, forma: FormaCobranca): Promise<void> {
    const caminho =
      forma === "PIX_AUTOMATICO" ? `/pix/automatic/authorizations/${id}/cancel` : `/subscriptions/${id}`;
    try {
      if (forma === "PIX_AUTOMATICO") await this.post(caminho, {});
      else await this.requisitar("DELETE", caminho);
    } catch (erro) {
      // Já não existe lá, ou já estava cancelada: o objetivo — não cobrar de
      // novo — está cumprido. Lançar aqui deixaria a assinatura presa como
      // ativa do nosso lado por causa de um sucesso.
      if (erro instanceof ErroGateway && erro.status === 404) {
        this.log.warn(`Assinatura ${id} já não existia no gateway ao cancelar.`);
        return;
      }
      throw erro;
    }
  }

  async buscarCobranca(id: string): Promise<CobrancaGateway | null> {
    try {
      const bruta = await this.get<PagamentoAsaas>(`/payments/${id}`);
      return this.paraCobranca(bruta);
    } catch (erro) {
      if (erro instanceof ErroGateway && erro.status === 404) return null;
      throw erro;
    }
  }

  async listarCobrancas(assinaturaId: string): Promise<CobrancaGateway[]> {
    const r = await this.get<{ data?: PagamentoAsaas[] }>(
      `/payments?subscription=${encodeURIComponent(assinaturaId)}&limit=100`,
    );
    return (r.data ?? []).map((p) => this.paraCobranca(p));
  }

  /** O JSON do Asaas vira o nosso tipo. Um lugar só, usado pelo webhook também. */
  paraCobranca(p: PagamentoAsaas): CobrancaGateway {
    return {
      id: p.id,
      status: p.status,
      billingType: p.billingType,
      valorCentavos: reaisParaCentavos(p.value),
      vencimento: p.dueDate,
      pagoEm: p.paymentDate ?? p.clientPaymentDate ?? null,
      valorPagoCentavos: p.netValue != null ? reaisParaCentavos(p.netValue) : null,
      linkPagamento: p.invoiceUrl ?? null,
      pixCopiaCola: null,
      linhaDigitavel: p.identificationField ?? null,
      referenciaExterna: p.externalReference ?? null,
    };
  }

  private billingType(forma: FormaCobranca): string {
    switch (forma) {
      case "CARTAO":
        return "CREDIT_CARD";
      case "BOLETO":
        return "BOLETO";
      default:
        return "PIX";
    }
  }

  private cycle(ciclo: CicloAssinatura): string {
    return ciclo === "ANUAL" ? "YEARLY" : "MONTHLY";
  }

  // --- HTTP ---------------------------------------------------------------

  private get<T>(caminho: string): Promise<T> {
    return this.requisitar<T>("GET", caminho);
  }

  private post<T>(caminho: string, corpo: unknown, metodo: "POST" | "PUT" = "POST"): Promise<T> {
    return this.requisitar<T>(metodo, caminho, corpo);
  }

  private async requisitar<T>(metodo: string, caminho: string, corpo?: unknown): Promise<T> {
    if (!this.config.habilitado) {
      throw new ErroGateway(null, false, "Gateway de pagamento não configurado no servidor.");
    }

    const controle = new AbortController();
    const relogio = setTimeout(() => controle.abort(), this.config.timeoutMs);

    let resposta: Response;
    try {
      resposta = await this.buscar(`${this.config.baseUrl}${caminho}`, {
        method: metodo,
        headers: {
          access_token: this.config.apiKey,
          "Content-Type": "application/json",
          // O Asaas pede identificação da integração; ajuda no suporte deles.
          "User-Agent": "Movatruck",
        },
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
        signal: controle.signal,
      });
    } catch (erro) {
      // Rede caiu ou estourou o timeout: transitório, dá pra tentar de novo.
      throw new ErroGateway(
        null,
        true,
        `Não foi possível falar com o gateway de pagamento: ${(erro as Error).message}`,
      );
    } finally {
      clearTimeout(relogio);
    }

    const texto = await resposta.text();

    if (!resposta.ok) {
      // O Asaas devolve os erros em `errors: [{ code, description }]`, e a
      // descrição é escrita pra humano ("CPF/CNPJ inválido") — é ela que vai
      // pra tela, não "400 Bad Request".
      let descricao = texto.slice(0, 300);
      try {
        const json = JSON.parse(texto) as { errors?: { description?: string }[] };
        const primeira = json.errors?.[0]?.description;
        if (primeira) descricao = json.errors!.map((e) => e.description).join(" · ");
      } catch {
        // Resposta sem JSON (HTML de proxy, por exemplo): fica o texto cru.
      }
      // 5xx e 429 passam sozinhos; 4xx de validação nunca passa por insistência.
      const transitorio = resposta.status >= 500 || resposta.status === 429;
      this.log.error(`${metodo} ${caminho} → ${resposta.status}: ${descricao}`);
      throw new ErroGateway(resposta.status, transitorio, descricao);
    }

    return (texto ? JSON.parse(texto) : {}) as T;
  }
}

/** O pagamento como o Asaas o devolve. Só os campos que a gente usa. */
export type PagamentoAsaas = {
  id: string;
  status: string;
  billingType: string;
  value: number;
  netValue?: number;
  dueDate: string;
  paymentDate?: string | null;
  clientPaymentDate?: string | null;
  invoiceUrl?: string | null;
  identificationField?: string | null;
  externalReference?: string | null;
  subscription?: string | null;
  customer?: string | null;
};

/**
 * Centavos → reais. `Math.round` porque `189000 / 100` é exato, mas a divisão
 * não é o risco: é somar dois floats depois. Na borda, arredonda e acabou.
 */
export function centavosParaReais(centavos: number): number {
  return Math.round(centavos) / 100;
}

/**
 * Reais → centavos.
 *
 * `Math.round` obrigatório: `189.9 * 100` dá 18989.999999999996 em ponto
 * flutuante, e truncar transformaria R$ 189,90 em R$ 189,89 — todo mês, e só
 * pra alguns valores, que é o tipo de bug que ninguém reproduz.
 */
export function reaisParaCentavos(reais: number): number {
  return Math.round(reais * 100);
}
