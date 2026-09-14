import type { CicloAssinatura, FormaCobranca } from "@ronan/shared-types";

/**
 * A porta de saída do dinheiro.
 *
 * Mesmo motivo do `EnvioWhatsappService`: quem chama declara O QUE quer
 * ("cria uma assinatura mensal de R$ 1.890 por Pix Automático"), nunca COMO —
 * e é essa separação que permite trocar de gateway sem caçar chamada por
 * service. Hoje existe um provedor só (Asaas); o dia em que a taxa do cartão
 * justificar um segundo, o que muda é esta implementação, não os serviços.
 *
 * Regra de ouro, igual à do WhatsApp: **o provedor lança em falha de
 * comunicação**, porque criar assinatura é operação de tela — quem clicou
 * precisa saber que não deu. O que NÃO pode lançar é o processamento de
 * webhook, e esse não passa por aqui.
 */

/** Quem paga. Um por empresa no gateway, reaproveitado entre assinaturas. */
export type ClienteGateway = {
  nome: string;
  /** CPF ou CNPJ, só dígitos. */
  documento: string;
  email: string;
  /** Com DDD, só dígitos. */
  telefone: string;
  /** Nosso id da conta, pra achar a empresa a partir do painel do gateway. */
  referenciaExterna: string;
};

export type NovaAssinaturaGateway = {
  clienteId: string;
  forma: FormaCobranca;
  ciclo: CicloAssinatura;
  valorCentavos: number;
  /** AAAA-MM-DD do primeiro vencimento. */
  primeiroVencimento: string;
  descricao: string;
  /** Nosso id da assinatura. É o que amarra o webhook de volta. */
  referenciaExterna: string;
};

export type AssinaturaCriada = {
  /** Id no gateway. Pra `PIX_AUTOMATICO` é o id da autorização. */
  id: string;
  /**
   * Copia-e-cola do QR do primeiro pagamento, quando a forma exige autorização.
   *
   * Não é segredo: quem tem o código consegue PAGAR a nossa conta, não sacar
   * dela. Guardar evita ter que recriar a autorização só pra reenviar o QR.
   */
  qrCodePayload?: string;
  qrCodeExpiraEm?: Date;
  /** Já nasce valendo? Pix Automático e cartão só depois do cliente autorizar. */
  ativaImediatamente: boolean;
};

/** Uma cobrança como o gateway a enxerga. */
export type CobrancaGateway = {
  id: string;
  /** Status cru do gateway. Quem traduz é `statusDoGateway`. */
  status: string;
  /** Forma crua do gateway ("PIX", "CREDIT_CARD"…). */
  billingType: string;
  valorCentavos: number;
  /** AAAA-MM-DD. */
  vencimento: string;
  /** AAAA-MM-DD, quando pago. */
  pagoEm?: string | null;
  valorPagoCentavos?: number | null;
  linkPagamento?: string | null;
  pixCopiaCola?: string | null;
  linhaDigitavel?: string | null;
  /** Nossa referência, se o gateway a devolveu. */
  referenciaExterna?: string | null;
};

export interface GatewayPagamento {
  readonly nome: string;
  /** Tem credencial pra operar? */
  configurado(): boolean;

  /**
   * Acha ou cria o cliente no gateway pelo documento.
   *
   * "Acha ou cria" e não "cria": rodar duas vezes com o mesmo CNPJ não pode
   * gerar dois clientes, senão o histórico de pagamento da empresa se parte em
   * dois e nenhum dos dois conta a verdade.
   */
  garantirCliente(dados: ClienteGateway): Promise<string>;

  /** Cria a assinatura (ou a autorização, no Pix Automático). */
  criarAssinatura(dados: NovaAssinaturaGateway): Promise<AssinaturaCriada>;

  /**
   * Cancela no gateway. Idempotente: cancelar o que já está cancelado (ou o que
   * nem existe mais lá) não é erro — o que importa é que não vai cobrar de novo.
   */
  cancelarAssinatura(id: string, forma: FormaCobranca): Promise<void>;

  /** O estado atual de uma cobrança. Usado pra conferir sem depender do webhook. */
  buscarCobranca(id: string): Promise<CobrancaGateway | null>;

  /** As cobranças que o gateway já gerou para uma assinatura. */
  listarCobrancas(assinaturaId: string): Promise<CobrancaGateway[]>;
}

/** Erro vindo do gateway, já com o que dá pra dizer pra quem está na tela. */
export class ErroGateway extends Error {
  constructor(
    readonly status: number | null,
    /** Dá pra tentar de novo? Rede e 5xx sim; "CNPJ inválido" nunca. */
    readonly transitorio: boolean,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = "ErroGateway";
  }
}
