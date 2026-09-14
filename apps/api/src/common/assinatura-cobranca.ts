import type { FormaCobranca, StatusCobranca } from "@ronan/shared-types";
import { ymdSaoPaulo } from "./timezone";

/**
 * As regras da mensalidade: que mês é este, quando vence, e quando avisar.
 *
 * Funções puras, sem Prisma nem Nest, pelo mesmo motivo de `estadoDaConta`:
 * é a régua que decide quando o sistema fala com o cliente sobre dinheiro. Se
 * ela erra, ou cobra alguém que já pagou, ou não cobra quem deve.
 *
 * Tudo aqui ancora em **São Paulo**, nunca em UTC. O container roda em UTC e
 * `setHours(0)` faria o vencimento do dia 10 virar dia 9 depois das 21h — todo
 * mês, para todo mundo.
 */

const DIA_MS = 86_400_000;

/**
 * A competência de uma data: o primeiro dia do mês dela, em meia-noite UTC
 * (que é como o Postgres devolve coluna `@db.Date`).
 *
 * É a chave humana da cobrança — "a de setembro" — e o que impede cobrar o
 * mesmo mês duas vezes.
 */
export function competenciaDe(data: Date = new Date()): Date {
  const [ano, mes] = ymdSaoPaulo(data);
  return new Date(Date.UTC(ano, mes - 1, 1));
}

/** A competência seguinte. Vira o ano sozinho. */
export function proximaCompetencia(competencia: Date, meses = 1): Date {
  return new Date(
    Date.UTC(competencia.getUTCFullYear(), competencia.getUTCMonth() + meses, 1),
  );
}

/**
 * Quando vence a cobrança de uma competência.
 *
 * O dia já chega limitado a 28 pelo schema — mas esta função não confia nisso e
 * prende no último dia do mês assim mesmo. Uma assinatura antiga com dia 31
 * gravado antes da regra existir não pode virar 3 de março em silêncio.
 */
export function vencimentoDe(competencia: Date, diaVencimento: number): Date {
  const ano = competencia.getUTCFullYear();
  const mes = competencia.getUTCMonth();
  const ultimoDia = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
  const dia = Math.min(Math.max(1, Math.trunc(diaVencimento)), ultimoDia);
  return new Date(Date.UTC(ano, mes, dia));
}

/** Hoje, como data civil de São Paulo em meia-noite UTC. */
export function hojeData(agora: Date = new Date()): Date {
  const [ano, mes, dia] = ymdSaoPaulo(agora);
  return new Date(Date.UTC(ano, mes - 1, dia));
}

/**
 * Dias inteiros de atraso. Negativo = ainda vai vencer, 0 = vence hoje.
 *
 * Conta em dias civis, não em horas: uma cobrança que vence hoje às 23h não
 * está "0,04 dia atrasada", está em dia.
 */
export function diasDeAtraso(vencimento: Date, agora: Date = new Date()): number {
  return Math.round((hojeData(agora).getTime() - vencimento.getTime()) / DIA_MS);
}

/**
 * Quantos dias antes do vencimento sai o aviso de "está aberta".
 *
 * Três dias é o que dá pro financeiro agendar o pagamento sem que o aviso
 * chegue tão cedo a ponto de ser esquecido.
 */
export const DIAS_AVISO_ANTES = 3;

/**
 * Em que atrasos o sistema avisa de novo.
 *
 * Para no terceiro de propósito. Depois disso não é mais cobrança automática,
 * é perturbação — e a decisão do que fazer com um cliente que não paga há um
 * mês é humana. Este sistema NUNCA corta acesso sozinho (decisão do dono em
 * 14/09/2026): a régua avisa, e quem mexe em `Conta.ativa` é uma pessoa.
 */
export const DIAS_AVISO_ATRASO = [1, 7, 15];

export type CobrancaParaRegua = {
  status: StatusCobranca;
  vencimento: Date;
  avisoAbertaEm: Date | null;
  avisoAtrasoEm: Date | null;
  avisosAtraso: number;
};

/** O que a régua manda fazer com uma cobrança hoje. */
export type AcaoRegua =
  | { tipo: "NADA"; motivo: string }
  | { tipo: "AVISAR_ABERTA"; diasParaVencer: number }
  | { tipo: "AVISAR_ATRASO"; diasDeAtraso: number };

/**
 * O que fazer com esta cobrança agora.
 *
 * Decide por DATA GRAVADA, nunca por booleano: "já avisei hoje?" se responde
 * comparando a data do último aviso com hoje, e é isso que faz o cron ser
 * idempotente de graça — rodar duas vezes no mesmo dia não manda duas
 * mensagens, e uma falha no meio não perde o aviso do dia seguinte.
 */
export function acaoDaRegua(c: CobrancaParaRegua, agora: Date = new Date()): AcaoRegua {
  // Pago é pago. Vale para CONFIRMADA e RECEBIDA: esperar o saldo liberar pra
  // parar de cobrar seria cobrar quem já pagou.
  if (c.status === "CONFIRMADA" || c.status === "RECEBIDA") {
    return { tipo: "NADA", motivo: "já foi paga" };
  }
  if (c.status === "CANCELADA" || c.status === "ESTORNADA") {
    return { tipo: "NADA", motivo: "não está mais em cobrança" };
  }

  const hoje = hojeData(agora);
  const atraso = diasDeAtraso(c.vencimento, agora);

  if (atraso < 0) {
    const faltam = -atraso;
    if (faltam > DIAS_AVISO_ANTES) {
      return { tipo: "NADA", motivo: `ainda faltam ${faltam} dias` };
    }
    if (c.avisoAbertaEm) return { tipo: "NADA", motivo: "o aviso de abertura já saiu" };
    return { tipo: "AVISAR_ABERTA", diasParaVencer: faltam };
  }

  // Venceu hoje ainda não é atraso: o dinheiro pode entrar até o fim do dia, e
  // mandar "está em atraso" pra quem tem o dia todo pra pagar queima confiança.
  if (atraso === 0) return { tipo: "NADA", motivo: "vence hoje" };

  if (c.avisosAtraso >= DIAS_AVISO_ATRASO.length) {
    return { tipo: "NADA", motivo: "a régua automática já se esgotou — daqui é conversa humana" };
  }
  if (c.avisoAtrasoEm && c.avisoAtrasoEm.getTime() >= hoje.getTime()) {
    return { tipo: "NADA", motivo: "já avisamos hoje" };
  }

  // O próximo marco ainda não chegou: avisa em D+1, D+7 e D+15, não todo dia.
  const proximoMarco = DIAS_AVISO_ATRASO[c.avisosAtraso]!;
  if (atraso < proximoMarco) {
    return { tipo: "NADA", motivo: `o próximo aviso é com ${proximoMarco} dias de atraso` };
  }

  return { tipo: "AVISAR_ATRASO", diasDeAtraso: atraso };
}

/**
 * O SUFIXO do link de pagamento — o que vai no botão de URL do template.
 *
 * A Meta não aceita URL inteira em parâmetro: o template aprovado carrega o
 * prefixo fixo (`https://www.asaas.com/i/`) e a mensagem manda só o final. Link
 * completo em parâmetro de corpo ela costuma tratar como conteúdo suspeito, e
 * foi assim que o botão do comprovante já teve que ser refeito uma vez.
 *
 * Se o formato do link mudar, isto devolve o link inteiro — que a Meta recusa,
 * mas o Evolution entrega. Falhar no provedor exigente e funcionar no outro é
 * melhor que mandar um botão apontando pro lugar errado.
 */
export function sufixoDoLink(link: string): string {
  const barra = link.lastIndexOf("/");
  return barra >= 0 ? link.slice(barra + 1) : link;
}

/**
 * O texto do WhatsApp e os parâmetros do template, juntos.
 *
 * Vêm do mesmo lugar porque são a MESMA mensagem em duas representações: o
 * texto é o que sai pelo Evolution e o que fica no histórico; os params são o
 * que a Meta preenche no template aprovado. Montar os dois em pontos
 * diferentes é como eles saem diferentes.
 *
 * Cada param é UMA LINHA — a Meta recusa parâmetro com quebra de linha. O
 * último é o sufixo do link, que só a Meta usa (é o botão).
 */
export function mensagemCobrancaAberta(dados: {
  nomeResponsavel: string;
  competenciaRotulo: string;
  valor: string;
  vencimento: string;
  link: string;
}): { texto: string; params: string[] } {
  const { nomeResponsavel, competenciaRotulo, valor, vencimento, link } = dados;
  return {
    texto:
      `Olá, ${nomeResponsavel}. A mensalidade do Movatruck de ${competenciaRotulo} ` +
      `está disponível para pagamento.\n\n` +
      `Valor: ${valor}\nVencimento: ${vencimento}\n\n` +
      `Para pagar: ${link}\n\n` +
      `Se o pagamento já foi feito, desconsidere esta mensagem.`,
    params: [nomeResponsavel, competenciaRotulo, valor, vencimento, link, sufixoDoLink(link)],
  };
}

/**
 * O convite pra autorizar a cobrança automática.
 *
 * Sai quando a assinatura é criada, não quando a fatura vence: entre "fechei o
 * contrato" e "3 dias antes do vencimento" havia um silêncio em que o cliente
 * não sabia como pagar nem que precisava fazer algo. É nesse silêncio que uma
 * assinatura fica parada para sempre esperando uma autorização que ninguém
 * pediu.
 *
 * `codigo` é o copia-e-cola do Pix (no Pix Automático) ou o link da cobrança
 * (no cartão e no boleto). No texto livre do Evolution ele vai inteiro; no
 * template da Meta, o link vai no botão e o código longo do Pix não cabe — por
 * isso o corpo explica o que fazer sem depender dele.
 */
export function mensagemAutorizacao(dados: {
  nomeResponsavel: string;
  valor: string;
  vencimento: string;
  codigo: string;
  ehPix: boolean;
}): { texto: string; params: string[] } {
  const { nomeResponsavel, valor, vencimento, codigo, ehPix } = dados;
  const comoPagar = ehPix
    ? `Copie o código abaixo e pague pelo app do seu banco:\n\n${codigo}`
    : `Informe os dados do cartão neste link:\n\n${codigo}`;

  // Mesmo tom transacional do template aprovado. O texto livre não passa pela
  // análise da Meta, mas o cliente pode receber por qualquer um dos dois
  // canais — e receber duas vozes diferentes da mesma empresa é estranho.
  return {
    texto:
      `Olá, ${nomeResponsavel}. A assinatura do Movatruck da sua empresa foi criada.\n\n` +
      `Para ativar a cobrança automática de ${valor} por mês, conclua o pagamento abaixo. ` +
      `Esta autorização é feita uma única vez.\n\n` +
      `${comoPagar}\n\n` +
      `Vencimento da primeira mensalidade: ${vencimento}\n\n` +
      `Qualquer dúvida, é só responder aqui.`,
    params: [nomeResponsavel, valor, vencimento, "", codigo, sufixoDoLink(codigo)],
  };
}

export function mensagemCobrancaAtrasada(dados: {
  nomeResponsavel: string;
  competenciaRotulo: string;
  valor: string;
  vencimento: string;
  link: string;
}): { texto: string; params: string[] } {
  const { nomeResponsavel, competenciaRotulo, valor, vencimento, link } = dados;
  return {
    // Sem ameaça e sem prazo de corte: o corte não é automático, então
    // anunciar um seria blefe — e blefe que o cliente descobre custa mais caro
    // que a mensalidade.
    texto:
      `Olá, ${nomeResponsavel}. A mensalidade do Movatruck de ${competenciaRotulo}, ` +
      `no valor de ${valor}, venceu em ${vencimento} e consta em aberto.\n\n` +
      `Para pagar: ${link}\n\n` +
      `Se o pagamento já foi feito, desconsidere esta mensagem.`,
    params: [nomeResponsavel, competenciaRotulo, valor, vencimento, link, sufixoDoLink(link)],
  };
}

const MESES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

/** "setembro/2026" — como uma pessoa chama o mês de referência. */
export function rotuloCompetencia(competencia: Date): string {
  return `${MESES[competencia.getUTCMonth()]}/${competencia.getUTCFullYear()}`;
}

/** "10/09/2026" a partir de uma coluna `@db.Date` (que vem em meia-noite UTC). */
export function formatarData(data: Date): string {
  const dia = String(data.getUTCDate()).padStart(2, "0");
  const mes = String(data.getUTCMonth() + 1).padStart(2, "0");
  return `${dia}/${mes}/${data.getUTCFullYear()}`;
}

/** Centavos → "R$ 1.890,00". */
export function formatarReais(centavos: number): string {
  return (centavos / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

/**
 * O status do gateway traduzido pro nosso.
 *
 * A tradução é explícita e devolve `null` pro que não reconhece, em vez de
 * chutar `PENDENTE`: status novo do gateway tratado como pendente faria uma
 * cobrança paga voltar a ser cobrada.
 */
export function statusDoGateway(status: string): StatusCobranca | null {
  switch (status) {
    case "PENDING":
    case "AWAITING_RISK_ANALYSIS":
    case "AWAITING_CHARGEBACK_REVERSAL":
      return "PENDENTE";
    case "CONFIRMED":
      return "CONFIRMADA";
    case "RECEIVED":
    case "RECEIVED_IN_CASH":
      return "RECEBIDA";
    case "OVERDUE":
      return "VENCIDA";
    case "REFUNDED":
    case "PARTIALLY_REFUNDED":
    case "CHARGEBACK_REQUESTED":
    case "CHARGEBACK_DISPUTE":
      return "ESTORNADA";
    case "DELETED":
      return "CANCELADA";
    default:
      return null;
  }
}

/** A forma de pagamento do gateway traduzida pra nossa. */
export function formaDoGateway(billingType: string): FormaCobranca | null {
  switch (billingType) {
    case "CREDIT_CARD":
    case "DEBIT_CARD":
      return "CARTAO";
    case "PIX":
      return "PIX";
    case "BOLETO":
      return "BOLETO";
    default:
      return null;
  }
}
